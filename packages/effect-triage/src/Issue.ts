import { Effect, Schema } from "effect";
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

/**
 * What someone set an issue to. A resolved issue opens again as regressed
 * when it happens after it was resolved; a muted one stays muted.
 */
export const Status = Schema.Literals(["open", "resolved", "muted"]);

export type Status = typeof Status.Type;

/**
 * Where an issue stands. Open issues are new for a week after they're first
 * seen, regressed for a week after they come back, quiet after a week without
 * events, and ongoing otherwise.
 */
export const State = Schema.Literals([
  "new",
  "ongoing",
  "quiet",
  "regressed",
  "resolved",
  "muted",
]);

export type State = typeof State.Type;

/**
 * How long an issue stays new or regressed, and how long without events before
 * it's quiet, in milliseconds.
 */
export const recentMillis = 7 * 24 * 60 * 60 * 1000;

/**
 * Events grouped by fingerprint: crashes and unit failures across every host
 * they happened on, errors and OOM kills on one host.
 */
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
  /** Older servers don't send this. */
  state: State.pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed("ongoing")),
  ),
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
      `${oom.process ?? (oom.unit === undefined ? "A process" : unitTemplate(oom.unit))} was killed for memory`,
    LogError: (log) =>
      `${log.identifier ?? (log.unit === undefined ? "unknown" : unitTemplate(log.unit))}: ${template(log.message)}`,
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
    state: "new",
  };
};
