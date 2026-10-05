import { Event } from "@timmo001/effect-triage";
import { Context, Effect, Layer, Option, Stream } from "effect";
import { type Entry, text } from "../journal/Entry.js";
import { Journal, type JournalError } from "../journal/Journal.js";
import { rawUnit, toEvent } from "../journal/toEvent.js";
import { Redactor } from "../redact.js";
import { Store, type StoreError } from "../store/Store.js";

/** The store's cursor key for this machine's journal. */
const source = "journal";

/** How many earlier lines from the same unit to keep with a failure or crash. */
const breadcrumbLines = 10;

const takesBreadcrumbs = Event.Event.isAnyOf(["UnitFailure", "Crash"]);

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

      const withBreadcrumbs = (entry: Entry, event: Event.Event) => {
        const bootId = text(entry, "_BOOT_ID");
        const unit = rawUnit(entry);

        if (
          !takesBreadcrumbs(event) ||
          unit === undefined ||
          bootId === undefined
        ) {
          return Effect.succeed(event);
        }

        return journal
          .before({
            cursor: entry.__CURSOR,
            bootId,
            ...unit,
            lines: breadcrumbLines,
          })
          .pipe(
            Effect.map((lines) =>
              lines.length === 0
                ? event
                : { ...event, breadcrumbs: lines.map(redact) },
            ),
            Effect.catch((error) =>
              Effect.logDebug("Couldn't read breadcrumbs", {
                error: error.message,
              }).pipe(Effect.as(event)),
            ),
          );
      };

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

                const events = yield* Effect.forEach(
                  entries.flatMap((entry) =>
                    Option.toArray(toEvent(entry, redact)).map(
                      (event) => [entry, event] as const,
                    ),
                  ),
                  ([entry, event]) => withBreadcrumbs(entry, event),
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
