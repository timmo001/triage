import { Context, Effect, Layer, Option, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { Entry, fields, text } from "./Entry.js";
import { MessageId, warningPriority } from "./toEvent.js";

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

export interface BeforeOptions {
  /** The entry to look back from, which is left out. */
  readonly cursor: string;
  readonly bootId: string;
  readonly unit: string;
  readonly scope: "system" | "user";
  /** The most lines to return. */
  readonly lines: number;
}

const decodeEntry = Schema.decodeUnknownEffect(Schema.fromJsonString(Entry));

const decodeEntryOption = Schema.decodeUnknownOption(
  Schema.fromJsonString(Entry),
);

/**
 * Reads the entries triage cares about from the journal: everything at
 * warning or worse, plus the catalog messages for crashes, failures and OOM
 * kills at any priority.
 */
export class Journal extends Context.Service<
  Journal,
  {
    read(options: ReadOptions): Stream.Stream<Entry, JournalError>;
    /**
     * The messages a unit logged before an entry, in the same boot, oldest
     * first. Raw, so they must be redacted before they're stored.
     */
    before(
      options: BeforeOptions,
    ): Effect.Effect<ReadonlyArray<string>, JournalError>;
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
              // Without this, fields over 4096 bytes are JSON null and crash stacks are dropped.
              "--all",
              `--output-fields=${fields.join(",")}`,
              ...(options.after === undefined
                ? []
                : [`--after-cursor=${options.after}`]),
              ...(options.follow ? ["--follow"] : []),
              ...Array.from(
                { length: warningPriority + 1 },
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

      const before = Effect.fn("Journal.before")(
        function* (options: BeforeOptions) {
          const lines = yield* spawner.lines(
            ChildProcess.make("journalctl", [
              "--output=json",
              "--no-pager",
              "--quiet",
              "--output-fields=MESSAGE",
              `--cursor=${options.cursor}`,
              "--reverse",
              `--lines=${options.lines + 1}`,
              `--boot=${options.bootId}`,
              options.scope === "user"
                ? `--user-unit=${options.unit}`
                : `--unit=${options.unit}`,
            ]),
          );

          return lines
            .flatMap((line) => Option.toArray(decodeEntryOption(line)))
            .filter((entry) => entry.__CURSOR !== options.cursor)
            .flatMap((entry) => text(entry, "MESSAGE") ?? [])
            .slice(0, options.lines)
            .reverse();
        },
        Effect.mapError((cause) => new JournalError({ cause })),
      );

      return Journal.of({ read, before });
    }),
  );
}
