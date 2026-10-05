import { Context, Effect, Layer, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { Entry, fields } from "./Entry.js";
import { MessageId, errorPriority } from "./toEvent.js";

export class JournalError extends Schema.TaggedError<JournalError>()(
  "JournalError",
  {
    cause: Schema.Defect(),
  },
) {}

export interface ReadOptions {
  /** Start after this cursor, or at the start of the journal when unset. */
  readonly after?: string | undefined;
  /** Keep reading new entries as they're written. */
  readonly follow: boolean;
}

const decodeEntry = Schema.decodeUnknownEffect(Schema.fromJsonString(Entry));

/**
 * Reads the entries triage cares about from the journal: everything at err or
 * worse, plus the catalog messages for crashes, failures and OOM kills at any
 * priority.
 */
export class Journal extends Context.Service<
  Journal,
  {
    read(options: ReadOptions): Stream.Stream<Entry, JournalError>;
  }
>()("triage/journal/Journal") {
  static readonly layer = Layer.effect(
    Journal,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

      const read = (options: ReadOptions) =>
        spawner
          .streamLines(
            ChildProcess.make("journalctl", [
              "--output=json",
              "--no-pager",
              "--quiet",
              `--output-fields=${fields.join(",")}`,
              ...(options.after === undefined
                ? []
                : [`--after-cursor=${options.after}`]),
              ...(options.follow ? ["--follow"] : []),
              ...Array.from(
                { length: errorPriority + 1 },
                (_, priority) => `PRIORITY=${priority}`,
              ),
              "+",
              ...Object.values(MessageId).map((id) => `MESSAGE_ID=${id}`),
            ]),
          )
          .pipe(
            Stream.mapError((cause) => new JournalError({ cause })),
            Stream.mapEffect((line) =>
              decodeEntry(line).pipe(
                Effect.map((entry) => [entry]),
                Effect.catch((error) =>
                  Effect.logWarning("Skipping an unreadable journal entry", {
                    error: error.message,
                  }).pipe(Effect.as([])),
                ),
              ),
            ),
            Stream.flattenIterable,
          );

      return Journal.of({ read });
    }),
  );
}
