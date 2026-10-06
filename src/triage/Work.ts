import type { Api } from "@timmo001/effect-triage";
import { Clock, Context, Duration, Effect, Layer, Option } from "effect";
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
    ): Effect.Effect<ReadonlyArray<Api.IssueDetail>, StoreError>;
    /** Store a decision, replacing any earlier one by the same model. */
    saveDecision(decision: StoredDecision): Effect.Effect<void, StoreError>;
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
    }): Effect.Effect<ReadonlyArray<Api.IssueDetail>, StoreError>;
    /** One issue with its latest events, to suggest a fix for on request. */
    issue(
      id: string,
    ): Effect.Effect<Option.Option<Api.IssueDetail>, StoreError>;
    /** Store a suggestion, replacing any earlier one by the same model. */
    saveSuggestion(
      suggestion: StoredSuggestion,
    ): Effect.Effect<void, StoreError>;
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
          }),
          saveDecision: (decision) => store.saveDecision(decision),
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
          }),
          issue: (id) => store.issue(id, issueEvents),
          saveSuggestion: (suggestion) => store.saveSuggestion(suggestion),
        });
      }),
    );
}
