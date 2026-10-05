import { Api, TriageClient } from "@timmo001/effect-triage-client";
import { Config, Context, Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { Store } from "../store/Store.js";

export interface UploadResult {
  /** Events sent to the server. */
  readonly sent: number;
  /** Events the server hadn't seen before. */
  readonly added: number;
}

/**
 * Sends stored events to a triage server in batches. Events stay in the local
 * store, which works as the spool when the server can't be reached, and each
 * batch is marked as sent only once the server accepts it.
 */
export class Uploader extends Context.Service<
  Uploader,
  {
    upload: Effect.Effect<
      UploadResult,
      Effect.Error<ReturnType<typeof upload>>
    >;
  }
>()("triage/upload/Uploader") {
  /** Upload to `$TRIAGE_SERVER` with the host token in `$TRIAGE_TOKEN`. */
  static readonly layer = Layer.unwrap(
    Effect.gen(function* () {
      const url = yield* Config.String("TRIAGE_SERVER");
      const token = yield* Config.Redacted("TRIAGE_TOKEN");

      return Layer.effect(
        Uploader,
        Effect.gen(function* () {
          const store = yield* Store;
          const client = yield* TriageClient;

          return Uploader.of({ upload: upload(url, store, client) });
        }),
      ).pipe(
        Layer.provide(TriageClient.layer({ url, token })),
        Layer.provide(FetchHttpClient.layer),
      );
    }),
  );
}

const upload = Effect.fnUntraced(function* (
  target: string,
  store: Store["Service"],
  client: TriageClient["Service"],
) {
  let sent = 0;
  let added = 0;

  while (true) {
    const batch = yield* store.pending(target, Api.maxBatch);

    if (batch.events.length === 0) {
      return { sent, added };
    }

    const result = yield* client.ingest.events({
      payload: { events: batch.events },
    });

    yield* store.uploaded(target, batch.last);

    sent += batch.events.length;
    added += result.added;
  }
});
