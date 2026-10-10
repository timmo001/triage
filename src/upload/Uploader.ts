import { Api, TriageClient } from "@timmo001/effect-triage-client";
import { Config, Context, Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { Store } from "../store/Store.js";

export interface UploadResult {
  /** Events sent to the server. */
  readonly sent: number;
  /** Events the server hadn't seen before. */
  readonly added: number;
  /** Warning counts sent to the server. */
  readonly warnings: number;
}

/**
 * Sends stored events to a triage server in batches. Events stay in the local
 * store, which works as the spool when the server can't be reached, and each
 * batch is marked as sent only once the server accepts it. Warning counts for
 * programs with an issue follow, and a server too old to take them only
 * skips them.
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
      break;
    }

    const result = yield* client.ingest.events({
      payload: { events: batch.events },
    });

    yield* store.uploaded(target, batch.last);

    sent += batch.events.length;
    added += result.added;
  }

  // Sent after the events, so the server has their issues to match them to.
  const warnings = yield* uploadWarnings(target, store, client).pipe(
    Effect.catch((error) =>
      Effect.logWarning("Couldn't upload warnings", {
        error: error.message,
      }).pipe(Effect.as(0)),
    ),
  );

  return { sent, added, warnings };
});

const uploadWarnings = Effect.fnUntraced(function* (
  target: string,
  store: Store["Service"],
  client: TriageClient["Service"],
) {
  let sent = 0;

  while (true) {
    const batch = yield* store.pendingWarnings(target, Api.maxBatch);

    if (batch.warnings.length === 0) {
      return sent;
    }

    yield* client.ingest.warnings({
      payload: { warnings: batch.warnings },
    });

    yield* store.warningsUploaded(target, batch.versions);

    sent += batch.warnings.length;
  }
});
