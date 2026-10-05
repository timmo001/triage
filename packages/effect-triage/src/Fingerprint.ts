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
 * The grouping key for an event. Events with the same fingerprint belong to
 * the same issue, on any host.
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
        failure.unit ?? failure.identifier ?? "?",
        failure.result ?? "",
      ].join("|"),
    OutOfMemory: (oom) => ["oom", oom.process ?? oom.unit ?? "?"].join("|"),
    LogError: (log) =>
      ["log", log.identifier ?? log.unit ?? "?", template(log.message)].join(
        "|",
      ),
  });

/** A short, stable ID for a fingerprint: 64-bit FNV-1a as 16 hex digits. */
export const issueId = (fingerprint: string): string => {
  let hash = 0xcbf29ce484222325n;

  for (const byte of new TextEncoder().encode(fingerprint)) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  }

  return hash.toString(16).padStart(16, "0");
};
