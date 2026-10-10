import { Api, TriageClient } from "@timmo001/effect-triage-client";
import { Config, Context, Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { Store } from "../store/Store.js";
import { isInternalUrl } from "../triage/internal.js";

export interface UploadResult {
  /** Events sent to the server. */
  readonly sent: number;
  /** Events the server hadn't seen before. */
  readonly added: number;
  /** Warning counts sent to the server. */
  readonly warnings: number;
  /** Values behind redaction tokens sent to the server. */
  readonly values: number;
}

/**
 * Sends stored events to a triage server in batches. Events stay in the local
 * store, which works as the spool when the server can't be reached, and each
 * batch is marked as sent only once the server accepts it. Warning counts for
 * programs with an issue follow, and then, only for a server on this machine's
 * own network that `$TRIAGE_SERVER_INTERNAL` marks internal, the values behind
 * redaction tokens. A server too old to take either only skips them.
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

      const internal = yield* Config.Boolean("TRIAGE_SERVER_INTERNAL").pipe(
        Config.withDefault(false),
      );

      // Only ever to a server on this machine's own network, whatever the
      // setting says, and saying when it's ignored.
      const sendValues = internal && isInternalUrl(url);

      if (sendValues) {
        yield* Effect.logInfo(
          "Sending the server the values behind redaction tokens, as it's on this network",
        );
      } else if (internal) {
        yield* Effect.logWarning(
          "Not sending the server the values behind redaction tokens: it isn't on this machine or its own network",
        );
      }

      return Layer.effect(
        Uploader,
        Effect.gen(function* () {
          const store = yield* Store;
          const client = yield* TriageClient;

          return Uploader.of({
            upload: upload(url, store, client, sendValues),
          });
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
  sendValues: boolean,
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

  const values = sendValues
    ? yield* uploadValues(target, store, client).pipe(
        Effect.catch((error) =>
          Effect.logWarning(
            "Couldn't send the values behind redaction tokens",
            {
              error: error.message,
            },
          ).pipe(Effect.as(0)),
        ),
      )
    : 0;

  return { sent, added, warnings, values };
});

const uploadValues = Effect.fnUntraced(function* (
  target: string,
  store: Store["Service"],
  client: TriageClient["Service"],
) {
  let sent = 0;

  while (true) {
    const redactions = yield* store.pendingRedactions(target, Api.maxBatch);

    if (redactions.length === 0) {
      return sent;
    }

    yield* client.ingest.redactions({ payload: { redactions } });

    yield* store.redactionsUploaded(
      target,
      redactions.map(({ token }) => token),
    );

    sent += redactions.length;
  }
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
