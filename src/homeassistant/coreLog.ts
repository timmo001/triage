import {
  Event,
  Fingerprint,
  type Severity,
  type Warning,
} from "@timmo001/effect-triage";
import type { Redact } from "../redact.js";
import { type Entry, text } from "../journal/Entry.js";

/** The journal's `SYSLOG_IDENTIFIER` for Home Assistant Core's container. */
export const coreIdentifier = "homeassistant";

/** Terminal colour codes, which Core's log has even when it isn't a terminal. */
const colours = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

/**
 * The start of a Core log record, in Core's own format:
 * `2026-10-10 12:00:00.123 ERROR (MainThread) [homeassistant.core] Message`.
 */
const recordStart =
  /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)? (?<level>[A-Z]+) \(.*?\) \[(?<logger>[^\]]+)\] (?<message>.*)$/s;

/** The severity of a Core log level that triage keeps, from warning up. */
const severityOf = (level: string): Severity.Severity | undefined => {
  switch (level) {
    case "CRITICAL":
      return "crit";
    case "ERROR":
      return "err";
    case "WARNING":
      return "warning";
    default:
      return undefined;
  }
};

const lineOf = (entry: Entry) =>
  (text(entry, "MESSAGE") ?? "").replace(colours, "");

/**
 * Where the last record starts in `entries`, or `undefined` when none does.
 * The lines from there on may be followed by more of its traceback.
 */
export const lastRecordStart = (
  entries: ReadonlyArray<Entry>,
): number | undefined => {
  const index = entries.findLastIndex((entry) =>
    recordStart.test(lineOf(entry)),
  );

  return index === -1 ? undefined : index;
};

/** One record Core logged, with the lines that followed it, such as a traceback. */
export interface CoreRecord {
  /** The journal entry that started it. */
  readonly entry: Entry;
  readonly severity: Severity.Severity;
  /** The logger that logged it, such as `homeassistant.components.hue`. */
  readonly logger: string;
  /** Its message, then any lines that followed it. */
  readonly lines: ReadonlyArray<string>;
}

/**
 * Group Core's journal entries into records. The journal holds one entry per
 * line Core wrote, so a traceback's lines follow the record that logged it.
 * Records below warning are left out, and so are lines before the first
 * record, such as the end of a traceback that started in an earlier batch.
 */
export const coreRecords = (
  entries: ReadonlyArray<Entry>,
): ReadonlyArray<CoreRecord> => {
  const records: Array<{
    entry: Entry;
    severity: Severity.Severity | undefined;
    logger: string;
    lines: Array<string>;
  }> = [];

  for (const entry of entries) {
    const line = lineOf(entry);
    const start = recordStart.exec(line)?.groups;

    if (start !== undefined) {
      records.push({
        entry,
        severity: severityOf(start.level ?? ""),
        logger: start.logger ?? coreIdentifier,
        lines: [start.message ?? ""],
      });
    } else {
      records.at(-1)?.lines.push(line);
    }
  }

  return records.flatMap(({ severity, ...record }) =>
    severity === undefined ? [] : [{ ...record, severity }],
  );
};

const common = (record: CoreRecord, host: string) => {
  const bootId = text(record.entry, "_BOOT_ID");

  return {
    host,
    bootId: bootId === undefined ? "" : Fingerprint.issueId(bootId),
    timestamp: Math.floor(record.entry.__REALTIME_TIMESTAMP / 1000),
  };
};

/**
 * Turn a Core record at error or worse into a log error from its logger, with
 * any traceback after the message, or nothing for a warning. Redacted here,
 * before it's stored, like every other event.
 */
export const coreEvent = (
  record: CoreRecord,
  host: string,
  redact: Redact,
): Event.Event | undefined => {
  if (record.severity === "warning") {
    return undefined;
  }

  const { bootId, ...rest } = common(record, host);

  return Event.Event.cases.LogError.make({
    ...rest,
    id: Fingerprint.issueId(record.entry.__CURSOR),
    source: "journal",
    ...(bootId !== "" && { bootId }),
    severity: record.severity,
    identifier: redact(record.logger),
    message: redact(record.lines.join("\n").trimEnd()),
  });
};

/** Turn a Core record at warning into one occurrence of a warning from its logger. */
export const coreWarning = (
  record: CoreRecord,
  host: string,
  redact: Redact,
): Warning.Warning | undefined => {
  const example = redact(record.lines[0] ?? "");
  const template = Fingerprint.template(example);

  if (record.severity !== "warning" || template === "") {
    return undefined;
  }

  const { timestamp, ...rest } = common(record, host);

  return {
    ...rest,
    identifier: redact(record.logger),
    template,
    example,
    count: 1,
    firstSeen: timestamp,
    lastSeen: timestamp,
  };
};
