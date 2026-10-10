import { Schema } from "effect";

/**
 * How often a program logged one warning in a boot, with the parts that change
 * between occurrences replaced. Hosts count every program's warnings, but only
 * send them for programs with an issue, where they're shown alongside it.
 */
export const Warning = Schema.Struct({
  /** The host the warnings came from: its enrolled name, never a raw hostname. */
  host: Schema.NonEmptyString,
  /** A hash of the boot they were logged in, or empty when unknown. */
  bootId: Schema.String,
  /** The program that logged them, such as journald's `SYSLOG_IDENTIFIER`. */
  identifier: Schema.optionalKey(Schema.String),
  /** The unit they belong to, with the parts that change between runs replaced. */
  unit: Schema.optionalKey(Schema.String),
  /** The redacted message with the parts that change replaced. */
  template: Schema.NonEmptyString,
  /** The latest redacted message. */
  example: Schema.String,
  count: Schema.Int.check(Schema.isGreaterThan(0)),
  /** When the first and latest were logged, in milliseconds since the Unix epoch. */
  firstSeen: Schema.Finite,
  lastSeen: Schema.Finite,
});

export interface Warning extends Schema.Schema.Type<typeof Warning> {}

/** The programs a warning can belong to, by identifier and by unit. */
export const programs = (warning: {
  readonly identifier?: string | undefined;
  readonly unit?: string | undefined;
}): ReadonlyArray<string> =>
  [warning.identifier, warning.unit].filter(
    (name): name is string => name !== undefined && name !== "",
  );
