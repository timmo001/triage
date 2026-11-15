import { Event } from "@timmo001/effect-triage";

/**
 * How far apart a unit failure and the crash or OOM kill behind it can be, and
 * systemd's own errors about the unit. The pairs checked on the server were
 * 2 ms to 2.5 s apart.
 */
export const causeWindowMillis = 10_000;

/**
 * How far apart the lines of a log burst can be, such as a firmware error
 * dump with one error per register line.
 */
export const burstWindowMillis = 2_000;

/** Why an event is in an issue other than its fingerprint's issue. */
export type EventRule = "cause" | "systemd";

/** A stored event, with where it is now. */
export interface Stored {
  readonly host: string;
  readonly id: string;
  readonly issueId: string;
  readonly fingerprint: string;
  readonly rule: EventRule | null;
  readonly event: Event.Event;
}

type UnitFailure = Extract<Event.Event, { readonly _tag: "UnitFailure" }>;

/** The kind of event that causes a unit failure with this result, if any. */
export const causeTag = (
  failure: UnitFailure,
): "Crash" | "OutOfMemory" | undefined => {
  switch (failure.result) {
    case "core-dump":
      return "Crash";
    case "oom-kill":
      return "OutOfMemory";
    default:
      return undefined;
  }
};

const sameUnit = (a: Event.Event, b: Event.Event) =>
  a.host === b.host &&
  a.unit !== undefined &&
  a.unit === b.unit &&
  a.scope === b.scope;

const within = (a: Event.Event, b: Event.Event, millis: number) =>
  Math.abs(a.timestamp - b.timestamp) <= millis;

/** Whether `cause` is the crash or OOM kill a unit failure came from. */
export const isCauseOf = (cause: Event.Event, failure: UnitFailure) => {
  const tag = causeTag(failure);

  return (
    tag !== undefined &&
    Event.Event.guards[tag](cause) &&
    sameUnit(cause, failure) &&
    within(cause, failure, causeWindowMillis)
  );
};

/**
 * The crash or OOM kill a unit failure came from, the closest in time on the
 * same host and unit. Either can arrive first, since a coredump can be
 * processed after the unit has already failed.
 */
export const causeOf = (
  failure: UnitFailure,
  candidates: ReadonlyArray<Stored>,
): Stored | undefined =>
  candidates
    .filter((candidate) => isCauseOf(candidate.event, failure))
    .sort(
      (a, b) =>
        Math.abs(a.event.timestamp - failure.timestamp) -
        Math.abs(b.event.timestamp - failure.timestamp),
    )[0];

/** Whether an event is one of systemd's own errors about a failed unit. */
export const isSystemdAbout = (event: Event.Event, failure: UnitFailure) =>
  Event.Event.guards.LogError(event) &&
  event.identifier === "systemd" &&
  sameUnit(event, failure) &&
  within(event, failure, causeWindowMillis);

/**
 * What a log error's burst is grouped by: the program that logged it. The
 * kernel logs for every driver under one identifier, so its errors also go by
 * the message's first word, such as `iwlwifi`, `ACPI` or `Bluetooth`, and
 * unrelated errors at boot don't become one burst.
 */
export const burstProgram = (event: Event.Event): string | undefined => {
  if (!Event.Event.guards.LogError(event)) {
    return undefined;
  }

  const program = event.identifier ?? event.unit;

  if (program === "kernel") {
    const word = /^[^\s:]+/.exec(event.message.trim())?.[0] ?? "";

    return `kernel|${word}`;
  }

  return program;
};
