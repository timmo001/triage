import { Context, Effect, Layer, Option, Stream } from "effect";
import { Journal, type JournalError } from "../journal/Journal.js";
import { toEvent } from "../journal/toEvent.js";
import { Redactor } from "../redact.js";
import { Store, type StoreError } from "../store/Store.js";

/** The store's cursor key for this machine's journal. */
const source = "journal";

export interface CollectResult {
  /** Journal entries read. */
  readonly entries: number;
  /** Events stored for the first time. */
  readonly added: number;
}

export interface CollectOptions {
  /** Keep collecting new entries as they're written. */
  readonly follow: boolean;
  /** Called after each batch is stored, with the running totals. */
  readonly onBatch?: (result: CollectResult) => Effect.Effect<void>;
}

/**
 * Reads this machine's journal from where it last stopped, turns entries into
 * redacted events and stores them, saving the cursor with each batch.
 */
export class Collector extends Context.Service<
  Collector,
  {
    collect(
      options: CollectOptions,
    ): Effect.Effect<CollectResult, JournalError | StoreError>;
  }
>()("triage/collect/Collector") {
  static readonly layer = Layer.effect(
    Collector,
    Effect.gen(function* () {
      const journal = yield* Journal;
      const store = yield* Store;
      const { redact } = yield* Redactor;

      const collect = Effect.fn("Collector.collect")(function* (
        options: CollectOptions,
      ) {
        const after = yield* store.cursor(source);
        const totals = { entries: 0, added: 0 };

        yield* journal
          .read({ after: Option.getOrUndefined(after), follow: options.follow })
          .pipe(
            Stream.groupedWithin(1000, "1 second"),
            Stream.runForEach(
              Effect.fnUntraced(function* (entries) {
                const last = entries.at(-1);

                if (last === undefined) {
                  return;
                }

                const events = entries.flatMap((entry) =>
                  Option.toArray(toEvent(entry, redact)),
                );

                totals.added += yield* store.record(
                  source,
                  events,
                  last.__CURSOR,
                );

                totals.entries += entries.length;

                if (options.onBatch !== undefined) {
                  yield* options.onBatch({ ...totals });
                }
              }),
            ),
          );

        return { ...totals };
      });

      return Collector.of({ collect });
    }),
  );
}
