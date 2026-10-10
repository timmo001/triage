import { Predicate, Schema } from "effect";

/**
 * A journald field as `journalctl -o json` writes it: a string, `null` when
 * too large to show, an array of bytes when not valid UTF-8, or an array of
 * those when a field repeats.
 */
const Field = Schema.optionalKey(
  Schema.Union([Schema.String, Schema.Null, Schema.Array(Schema.Unknown)]),
);

/** The journald fields triage reads. */
export const Entry = Schema.Struct({
  __CURSOR: Schema.NonEmptyString,
  __REALTIME_TIMESTAMP: Schema.FiniteFromString,
  _BOOT_ID: Field,
  _EXE: Field,
  _TRANSPORT: Field,
  _HOSTNAME: Field,
  _SYSTEMD_UNIT: Field,
  _SYSTEMD_USER_UNIT: Field,
  /** Set by Docker on a container's output, such as a Home Assistant app's. */
  CONTAINER_NAME: Field,
  COREDUMP_COMM: Field,
  COREDUMP_EXE: Field,
  COREDUMP_SIGNAL_NAME: Field,
  COREDUMP_UNIT: Field,
  COREDUMP_USER_UNIT: Field,
  MESSAGE: Field,
  MESSAGE_ID: Field,
  PRIORITY: Field,
  SYSLOG_IDENTIFIER: Field,
  UNIT: Field,
  UNIT_RESULT: Field,
  USER_UNIT: Field,
});

export interface Entry extends Schema.Schema.Type<typeof Entry> {}

/** The fields to ask `journalctl --output-fields` for. */
export const fields = Object.keys(Entry.fields).filter(
  (field) => !field.startsWith("__"),
);

export type Field = Exclude<keyof Entry, `__${string}`>;

const decoder = new TextDecoder();

const isBytes = (value: ReadonlyArray<unknown>): value is Array<number> =>
  value.every(Predicate.isNumber);

/** A field's value as text, taking the first value of a repeated field. */
export const text = (entry: Entry, field: Field): string | undefined => {
  const value = entry[field];

  if (Predicate.isString(value)) {
    return value;
  }

  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }

  if (isBytes(value)) {
    return decoder.decode(Uint8Array.from(value));
  }

  const [first] = value;

  return Predicate.isString(first) ? first : undefined;
};
