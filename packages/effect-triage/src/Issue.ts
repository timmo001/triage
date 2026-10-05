import { Schema } from "effect";
import { Event } from "./Event.js";
import { fingerprint, issueId, template, unitTemplate } from "./Fingerprint.js";

/** The kind of event an issue groups, matching the event's tag. */
export const Kind = Schema.Literals([
  "Crash",
  "UnitFailure",
  "OutOfMemory",
  "LogError",
]);

export type Kind = typeof Kind.Type;

/** Events grouped by fingerprint, across every host they happened on. */
export const Issue = Schema.Struct({
  /** {@link issueId} of the fingerprint. */
  id: Schema.NonEmptyString,
  fingerprint: Schema.NonEmptyString,
  kind: Kind,
  /** A short, human summary of the issue. */
  title: Schema.String,
  /** When the first and latest events happened, in milliseconds since the Unix epoch. */
  firstSeen: Schema.Finite,
  lastSeen: Schema.Finite,
  /** How many events the issue has. */
  count: Schema.Int,
});

export interface Issue extends Schema.Schema.Type<typeof Issue> {}

const basename = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** A short, human summary of the issue an event belongs to. */
export const title = (event: Event): string =>
  Event.match(event, {
    Crash: (crash) =>
      `${basename(crash.executable)} crashed with ${crash.signal}`,
    UnitFailure: (failure) =>
      `${unitTemplate(failure.unit ?? failure.identifier ?? "A unit")} failed${failure.result === undefined ? "" : ` (${failure.result})`}`,
    OutOfMemory: (oom) =>
      `${oom.process ?? oom.unit ?? "A process"} was killed for memory`,
    LogError: (log) =>
      `${log.identifier ?? log.unit ?? "unknown"}: ${template(log.message)}`,
  });

/** The issue an event starts, before any other event joins it. */
export const fromEvent = (event: Event): Issue => {
  const key = fingerprint(event);

  return {
    id: issueId(key),
    fingerprint: key,
    kind: event._tag,
    title: title(event),
    firstSeen: event.timestamp,
    lastSeen: event.timestamp,
    count: 1,
  };
};
