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

/**
 * Where Core's events come from, apart from the host's own journal, and the
 * store's cursor key for reading them.
 */
export const coreSource = "homeassistant-core";

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

/** How long before an error Core's other records are kept with it, in milliseconds. */
const breadcrumbMillis = 30_000;

/** The most of Core's earlier records kept with an error. */
const breadcrumbRecords = 10;

const levelNames: Record<Severity.Severity, string> = {
  emerg: "CRITICAL",
  alert: "CRITICAL",
  crit: "CRITICAL",
  err: "ERROR",
  warning: "WARNING",
  notice: "INFO",
  info: "INFO",
  debug: "DEBUG",
};

const millisOf = (record: CoreRecord) =>
  Math.floor(record.entry.__REALTIME_TIMESTAMP / 1000);

/** A record's first line, with its level and logger, as a breadcrumb. */
const breadcrumbOf = (record: CoreRecord) =>
  `${levelNames[record.severity]} [${record.logger}] ${record.lines[0] ?? ""}`;

/**
 * Pair each record with what Core logged in the {@link breadcrumbMillis}
 * before it, from any logger, oldest first, carrying on from the records in
 * `previous`. Returns the records to carry on from next time too, since
 * batches don't line up with what happened.
 */
export const withBreadcrumbs = (
  previous: ReadonlyArray<CoreRecord>,
  records: ReadonlyArray<CoreRecord>,
) => {
  let recent = previous;

  const paired = records.map((record) => {
    const at = millisOf(record);

    const breadcrumbs = recent
      .filter((earlier) => at - millisOf(earlier) <= breadcrumbMillis)
      .map(breadcrumbOf);

    recent = [...recent, record].slice(-breadcrumbRecords);

    return { record, breadcrumbs };
  });

  return { records: paired, recent };
};

const integrationLogger =
  /^(?<prefix>homeassistant\.components|custom_components)\.(?<domain>[a-z0-9_]+)/;

/**
 * The integration a logger belongs to: `homeassistant.components.hue.light`
 * is the built-in `hue`, and `custom_components.thing` the custom `thing`.
 */
export const integrationOf = (
  logger: string,
): Event.Integration | undefined => {
  const match = integrationLogger.exec(logger)?.groups;

  return match?.domain === undefined
    ? undefined
    : {
        domain: match.domain,
        custom: match.prefix === "custom_components",
      };
};

const common = (record: CoreRecord, host: string) => {
  const bootId = text(record.entry, "_BOOT_ID");

  return {
    host,
    bootId: bootId === undefined ? "" : Fingerprint.issueId(bootId),
    timestamp: Math.floor(record.entry.__REALTIME_TIMESTAMP / 1000),
  };
};

const unchanged: Redact = (text) => text;

/**
 * Turn a Core record at error or worse into a log error from its logger, with
 * any traceback after the message and what Core logged just before, or
 * nothing for a warning. Redacted here, before it's stored, like every other
 * event, with Home Assistant's own names taken out of the message by
 * `redactNames` first.
 */
export const coreEvent = (
  record: CoreRecord,
  host: string,
  redact: Redact,
  breadcrumbs: ReadonlyArray<string> = [],
  redactNames: Redact = unchanged,
): Event.Event | undefined => {
  if (record.severity === "warning") {
    return undefined;
  }

  const { bootId, ...rest } = common(record, host);
  const identifier = redact(record.logger);
  const integration = integrationOf(identifier);
  const redactText = (text: string) => redact(redactNames(text));

  return Event.Event.cases.LogError.make({
    ...rest,
    id: Fingerprint.issueId(record.entry.__CURSOR),
    source: coreSource,
    ...(bootId !== "" && { bootId }),
    severity: record.severity,
    identifier,
    message: redactText(record.lines.join("\n").trimEnd()),
    ...(breadcrumbs.length > 0 && {
      breadcrumbs: breadcrumbs.map(redactText),
    }),
    ...(integration !== undefined && { integration }),
  });
};

/** Turn a Core record at warning into one occurrence of a warning from its logger. */
export const coreWarning = (
  record: CoreRecord,
  host: string,
  redact: Redact,
  redactNames: Redact = unchanged,
): Warning.Warning | undefined => {
  const example = redact(redactNames(record.lines[0] ?? ""));
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
