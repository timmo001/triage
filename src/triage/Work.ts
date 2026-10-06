import type { Api } from "@timmo001/effect-triage";
import { TriageClient } from "@timmo001/effect-triage-client";
import {
  Clock,
  Config,
  Context,
  Duration,
  Effect,
  Layer,
  Option,
  Schema,
} from "effect";
import { FetchHttpClient } from "effect/http";
import {
  Store,
  type StoreError,
  type StoredDecision,
  type StoredSuggestion,
} from "../store/Store.js";

/** The window daily limits count over. */
export const dayMillis = Duration.toMillis(Duration.days(1));

/** How many of an issue's latest events describe it to a model. */
export const issueEvents = 20;

/** The store or the server couldn't give out work or keep an answer. */
export class WorkError extends Schema.TaggedError<WorkError>()("WorkError", {
  cause: Schema.Defect(),
}) {
  override get message() {
    return this.cause instanceof Error
      ? this.cause.message
      : String(this.cause);
  }
}

const toWorkError = (cause: unknown) => new WorkError({ cause });

/**
 * Where decide and suggest get their issues and keep their answers: the local
 * store, or a server this device works for. Daily limits are applied where the
 * answers are stored, so every worker for a server shares them.
 */
export class Work extends Context.Service<
  Work,
  {
    /**
     * Issues `model` hasn't decided on yet, with their latest events, most
     * recently seen first. Fewer than `limit` once the daily limit is near.
     */
    toDecide(
      model: string,
      limit: number,
    ): Effect.Effect<ReadonlyArray<Api.IssueDetail>, WorkError>;
    /** Store a decision, replacing any earlier one by the same model. */
    saveDecision(decision: StoredDecision): Effect.Effect<void, WorkError>;
    /**
     * Issues `decisionModel` rated at least `worth` that `model` hasn't
     * suggested a fix for, with their latest events, most recently seen
     * first. Fewer than `limit` once the daily limit is near.
     */
    toSuggest(options: {
      readonly model: string;
      readonly decisionModel: string;
      readonly worth: number;
      readonly limit: number;
    }): Effect.Effect<ReadonlyArray<Api.IssueDetail>, WorkError>;
    /** One issue with its latest events, to suggest a fix for on request. */
    issue(id: string): Effect.Effect<Option.Option<Api.IssueDetail>, WorkError>;
    /** Store a suggestion, replacing any earlier one by the same model. */
    saveSuggestion(
      suggestion: StoredSuggestion,
    ): Effect.Effect<void, WorkError>;
  }
>()("triage/triage/Work") {
  /**
   * Work from the local store, with at most `decideDaily` decisions and
   * `suggestDaily` suggestions per model in any 24 hours. Without them there's
   * no daily limit, for one-off runs someone asked for.
   */
  static readonly layerStore = (options: {
    readonly decideDaily?: number;
    readonly suggestDaily?: number;
  }) =>
    Layer.effect(
      Work,
      Effect.gen(function* () {
        const store = yield* Store;

        const left = Effect.fnUntraced(function* (
          daily: number | undefined,
          since: (since: number) => Effect.Effect<number, StoreError>,
        ) {
          if (daily === undefined) {
            return Number.POSITIVE_INFINITY;
          }

          return (
            daily - (yield* since((yield* Clock.currentTimeMillis) - dayMillis))
          );
        });

        const details = (ids: ReadonlyArray<{ readonly id: string }>) =>
          Effect.forEach(ids, ({ id }) => store.issue(id, issueEvents)).pipe(
            Effect.map((found) => found.flatMap(Option.toArray)),
          );

        return Work.of({
          toDecide: Effect.fn("Work.toDecide")(function* (model, limit) {
            const allowed = Math.min(
              limit,
              yield* left(options.decideDaily, (since) =>
                store.decidedSince(model, since),
              ),
            );

            if (allowed <= 0) {
              return [];
            }

            return yield* details(yield* store.undecided(model, allowed));
          }, Effect.mapError(toWorkError)),
          saveDecision: (decision) =>
            store.saveDecision(decision).pipe(Effect.mapError(toWorkError)),
          toSuggest: Effect.fn("Work.toSuggest")(function* (request) {
            const allowed = Math.min(
              request.limit,
              yield* left(options.suggestDaily, (since) =>
                store.suggestedSince(request.model, since),
              ),
            );

            if (allowed <= 0) {
              return [];
            }

            return yield* details(
              yield* store.unsuggested({ ...request, limit: allowed }),
            );
          }, Effect.mapError(toWorkError)),
          issue: (id) =>
            store.issue(id, issueEvents).pipe(Effect.mapError(toWorkError)),
          saveSuggestion: (suggestion) =>
            store.saveSuggestion(suggestion).pipe(Effect.mapError(toWorkError)),
        });
      }),
    );

  /**
   * Work for the server at `$TRIAGE_SERVER`, authenticating with the worker
   * token in `$TRIAGE_WORKER_TOKEN`. The server applies its daily limits.
   */
  static readonly layerRemote = Layer.unwrap(
    Effect.gen(function* () {
      const url = yield* Config.String("TRIAGE_SERVER");
      const token = yield* Config.Redacted("TRIAGE_WORKER_TOKEN");

      return Layer.effect(
        Work,
        Effect.gen(function* () {
          const client = yield* TriageClient;

          return Work.of({
            toDecide: (model, limit) =>
              client.work
                .toDecide({ query: { model, limit } })
                .pipe(Effect.mapError(toWorkError)),
            saveDecision: (decision) =>
              client.work
                .saveDecision({ payload: decision })
                .pipe(Effect.mapError(toWorkError)),
            toSuggest: (request) =>
              client.work
                .toSuggest({ query: request })
                .pipe(Effect.mapError(toWorkError)),
            issue: (id) =>
              client.work.issue({ params: { id } }).pipe(
                Effect.asSome,
                Effect.catchTag("IssueNotFound", () => Effect.succeedNone),
                Effect.mapError(toWorkError),
              ),
            saveSuggestion: (suggestion) =>
              client.work
                .saveSuggestion({ payload: suggestion })
                .pipe(Effect.mapError(toWorkError)),
          });
        }),
      ).pipe(
        Layer.provide(TriageClient.layer({ url, token })),
        Layer.provide(FetchHttpClient.layer),
      );
    }),
  );
}
