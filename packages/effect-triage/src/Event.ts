import { Effect, Schema } from "effect";
import { Severity } from "./Severity.js";

/** One frame of a crash stack trace, innermost first. */
export const Frame = Schema.Struct({
  /** The function name, when symbols were available. */
  function: Schema.optionalKey(Schema.String),
  /** The executable or shared library the frame belongs to. */
  module: Schema.optionalKey(Schema.String),
});

export interface Frame extends Schema.Schema.Type<typeof Frame> {}

const common = {
  /** Unique per source, such as a hash of a journal cursor, so an event is stored once. */
  id: Schema.NonEmptyString,
  /** The host the event came from: its enrolled name, never a raw hostname. */
  host: Schema.NonEmptyString,
  /**
   * Where on the host the event was read from, such as `journal`. Events from
   * before 0.5.0 have none and decode as `journal`, the only source then.
   */
  source: Schema.NonEmptyString.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed("journal")),
  ),
  /** A hash of the boot the event happened in. */
  bootId: Schema.optionalKey(Schema.String),
  /** When the event happened, in milliseconds since the Unix epoch. */
  timestamp: Schema.Finite,
  severity: Severity,
  /** The program that logged the event, such as journald's `SYSLOG_IDENTIFIER`. */
  identifier: Schema.optionalKey(Schema.String),
  /** The systemd unit the event belongs to. */
  unit: Schema.optionalKey(Schema.String),
  /** Whether `unit` runs in the system manager or a user's. */
  scope: Schema.optionalKey(Schema.Literals(["system", "user"])),
  /** The redacted message. */
  message: Schema.String,
  /**
   * Redacted lines the same unit logged just before, in the same boot, oldest
   * first.
   */
  breadcrumbs: Schema.optionalKey(Schema.Array(Schema.String)),
};

/**
 * Something that went wrong on a machine. Every source produces these, so
 * grouping and triage don't depend on where an event came from.
 */
export const Event = Schema.TaggedUnion({
  /** A process dumped core. */
  Crash: {
    ...common,
    /** Path of the executable that crashed. */
    executable: Schema.NonEmptyString,
    /** Signal name, such as `SIGSEGV`. */
    signal: Schema.NonEmptyString,
    /** Stack trace of the crashing thread, innermost frame first. */
    frames: Schema.Array(Frame),
  },
  /** A systemd unit or job failed. */
  UnitFailure: {
    ...common,
    /** systemd's result, such as `exit-code` or `timeout`. */
    result: Schema.optionalKey(Schema.String),
  },
  /** The kernel OOM killer or systemd-oomd killed a process. */
  OutOfMemory: {
    ...common,
    /** Name of the killed process. */
    process: Schema.optionalKey(Schema.String),
  },
  /** A log line at err or worse. */
  LogError: common,
});

export type Event = typeof Event.Type;
