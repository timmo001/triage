import { Event } from "./Event.js";

/** How many crash frames take part in a crash's fingerprint. */
const crashFrames = 3;

const replacements: ReadonlyArray<readonly [RegExp, string]> = [
  // A whole URL, path and all, so the same failure with several endpoints is
  // one issue. It may already hold a redacted <ip>, but a bare < or > around
  // it, and trailing punctuation, stay outside it.
  [
    /\b[a-z][a-z0-9+.-]*:\/\/(?:<\w+>|[^\s'"`)\]<>])*(?:<\w+>|[^\s'"`)\]<>.,;:!?])/gi,
    "<url>",
  ],
  [
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    "<uuid>",
  ],
  [/\b[0-9a-f]{2}([:_-])[0-9a-f]{2}(?:\1[0-9a-f]{2}){4}\b/gi, "<mac>"],
  [/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, "<ip>"],
  [/\b0x[0-9a-f]+\b/gi, "<hex>"],
  [/\b[0-9a-f]{12,}\b/gi, "<hex>"],
  [/(?<![\w<])\/[^\s:,;'")\]]+/g, "<path>"],
  // A number with a unit of time, size, frequency or signal, such as a
  // back-off's 30s or an OOM kill's 512kB, keeping the unit.
  [
    /(?<!\w)-?\d+(?:\.\d+)?(?=(?:ns|us|µs|ms|s|min|m|h|d|[kKMGT]i?B|[kKMGT]|B|[kMG]?Hz|dBm|dB)\b)/g,
    "<n>",
  ],
  [/(?<!\w)-?\b\d+(?:\.\d+)?\b/g, "<n>"],
];

/**
 * Redaction tokens, such as `<ip:71d0a3c2e94b>`, which a host can show the value
 * behind. They group as their kind, `<ip>`, like a plain placeholder.
 */
const tokens = /<([a-z]+):[0-9a-f]{12}>/g;

/** Text with its redaction tokens turned back into plain placeholders. */
export const untokened = (text: string): string => text.replace(tokens, "<$1>");

/**
 * Reduce a log message to its template by replacing the parts that change
 * between occurrences: redaction tokens, URLs, UUIDs, MAC and IP addresses,
 * hex values, paths and numbers, with or without a unit.
 */
export const template = (message: string): string =>
  replacements
    .reduce(
      (text, [pattern, replacement]) => text.replace(pattern, replacement),
      untokened(message),
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
  untokened(unit)
    .replace(/@[\d_-]+(?=\.[a-z]+$)/, "@<n>")
    .replace(/^(app-.+)-(?:[0-9a-f]{8}|\d+)(?=\.scope$)/, "$1-<id>")
    .replace(
      /^run-(?:p\d+-i\d+|u\d+|r[0-9a-f]+)(?=\.(?:service|scope)$)/,
      "run-<id>",
    )
    .replace(/^session-\w+(?=\.scope$)/, "session-<id>");

/**
 * The grouping key for an event. Events with the same fingerprint belong to
 * the same issue, on any host. Redaction tokens count as their kind, so a
 * host keeping the values behind them groups the same as one that doesn't.
 */
export const fingerprint = (event: Event): string =>
  untokened(fingerprintOf(event));

const fingerprintOf = (event: Event): string =>
  Event.match(event, {
    Crash: (crash) =>
      [
        "crash",
        basename(crash.executable),
        crash.signal,
        ...crash.frames
          .slice(0, crashFrames)
          .map(
            (frame) =>
              frame.function ??
              (frame.module === undefined ? "?" : basename(frame.module)),
          ),
      ].join("|"),
    UnitFailure: (failure) =>
      [
        "unit",
        unitTemplate(failure.unit ?? failure.identifier ?? "?"),
        failure.result ?? "",
      ].join("|"),
    OutOfMemory: (oom) =>
      ["oom", oom.process ?? unitTemplate(oom.unit ?? "?")].join("|"),
    LogError: (log) =>
      [
        "log",
        log.identifier ?? unitTemplate(log.unit ?? "?"),
        template(log.message),
      ].join("|"),
  });

/**
 * The start of a fingerprint that similar issues share: a crash of the same
 * program with the same signal, the same unit failing in any way, another
 * error from the same program, or another OOM kill.
 */
export const family = (key: string): string => {
  const parts = key.split("|");

  switch (parts[0]) {
    case "crash":
      return `${parts.slice(0, 3).join("|")}|`;
    case "unit":
    case "log":
      return `${parts.slice(0, 2).join("|")}|`;
    case "oom":
      return "oom|";
    default:
      return key;
  }
};

/**
 * The program or unit a fingerprint belongs to: the crashed executable, the
 * failed unit, the program that logged the error or the process killed for
 * memory. Warnings from it are shown with the issue.
 */
export const program = (key: string): string | undefined => {
  const [, name] = key.split("|");

  return name === undefined || name === "" || name === "?" ? undefined : name;
};

const encoder = new TextEncoder();

/** The FNV-1a 64-bit prime, 2^40 + 0x1b3, as the low part of its product. */
const prime = 0x1b3;

/**
 * A short, stable ID for a fingerprint: 64-bit FNV-1a as 16 hex digits. The
 * hash is kept as two 32-bit halves, since multiplying by the prime in plain
 * number arithmetic is several times quicker than with BigInt and this runs
 * for every event and warning.
 */
export const issueId = (fingerprint: string): string => {
  let high = 0xcbf29ce4;
  let low = 0x84222325;

  for (const byte of encoder.encode(fingerprint)) {
    low = (low ^ byte) >>> 0;

    // hash * (2^40 + 0x1b3) mod 2^64: the low half shifted up by 40 bits
    // lands in the high half, and the small multiple carries into it.
    const product = low * prime;

    high =
      ((low << 8) +
        Math.imul(high, prime) +
        Math.floor(product / 0x100000000)) >>>
      0;
    low = product >>> 0;
  }

  return high.toString(16).padStart(8, "0") + low.toString(16).padStart(8, "0");
};
