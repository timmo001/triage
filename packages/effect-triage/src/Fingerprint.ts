import { Event } from "./Event.js";

/** How many crash frames take part in a crash's fingerprint. */
const crashFrames = 3;

const replacements: ReadonlyArray<readonly [RegExp, string]> = [
  [
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    "<uuid>",
  ],
  [/\b[0-9a-f]{2}([:_-])[0-9a-f]{2}(?:\1[0-9a-f]{2}){4}\b/gi, "<mac>"],
  [/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, "<ip>"],
  [/\b0x[0-9a-f]+\b/gi, "<hex>"],
  [/\b[0-9a-f]{12,}\b/gi, "<hex>"],
  [/(?<![\w<])\/[^\s:,;'")\]]+/g, "<path>"],
  [/(?<!\w)-?\b\d+(?:\.\d+)?\b/g, "<n>"],
];

/**
 * Reduce a log message to its template by replacing the parts that change
 * between occurrences: UUIDs, MAC and IP addresses, hex values, paths and
 * numbers.
 */
export const template = (message: string): string =>
  replacements
    .reduce(
      (text, [pattern, replacement]) => text.replace(pattern, replacement),
      message,
    )
    .replace(/\s+/g, " ")
    .trim();

const basename = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/**
 * A unit's name without the parts that change between runs, so they group as
 * one: a templated unit's instance of only numbers, such as a process or user
 * ID, the random or PID suffix of an app's transient scope, `systemd-run`'s
 * generated names and login session numbers.
 */
export const unitTemplate = (unit: string) =>
  unit
    .replace(/@[\d_-]+(?=\.[a-z]+$)/, "@<n>")
    .replace(/^(app-.+)-(?:[0-9a-f]{8}|\d+)(?=\.scope$)/, "$1-<id>")
    .replace(
      /^run-(?:p\d+-i\d+|u\d+|r[0-9a-f]+)(?=\.(?:service|scope)$)/,
      "run-<id>",
    )
    .replace(/^session-\w+(?=\.scope$)/, "session-<id>");

/**
 * A fingerprint kept to one host. Errors and OOM kills with the same wording
 * often have a cause particular to each machine, so they group per host.
 */
export const onHost = (key: string, host: string) => `${key}|${host}`;

/**
 * The grouping key for an event. Events with the same fingerprint belong to
 * the same issue: crashes and unit failures on any host, errors and OOM kills
 * on one host.
 */
export const fingerprint = (event: Event): string =>
  Event.match(event, {
    Crash: (crash) =>
      [
        "crash",
        basename(crash.executable),
        crash.signal,
        ...crash.frames
          .slice(0, crashFrames)
          .map((frame) => frame.function ?? frame.module ?? "?"),
      ].join("|"),
    UnitFailure: (failure) =>
      [
        "unit",
        unitTemplate(failure.unit ?? failure.identifier ?? "?"),
        failure.result ?? "",
      ].join("|"),
    OutOfMemory: (oom) =>
      onHost(
        ["oom", oom.process ?? unitTemplate(oom.unit ?? "?")].join("|"),
        oom.host,
      ),
    LogError: (log) =>
      onHost(
        [
          "log",
          log.identifier ?? unitTemplate(log.unit ?? "?"),
          template(log.message),
        ].join("|"),
        log.host,
      ),
  });

/**
 * The start of a fingerprint that similar issues share: a crash of the same
 * program with the same signal, the same unit failing in any way, or the same
 * error or OOM kill on another host.
 */
export const family = (key: string): string => {
  const parts = key.split("|");

  switch (parts[0]) {
    case "crash":
      return `${parts.slice(0, 3).join("|")}|`;
    case "unit":
      return `${parts.slice(0, 2).join("|")}|`;
    case "oom":
    case "log":
      return key.slice(0, key.lastIndexOf("|") + 1);
    default:
      return key;
  }
};

/** A short, stable ID for a fingerprint: 64-bit FNV-1a as 16 hex digits. */
export const issueId = (fingerprint: string): string => {
  let hash = 0xcbf29ce484222325n;

  for (const byte of new TextEncoder().encode(fingerprint)) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  }

  return hash.toString(16).padStart(16, "0");
};
