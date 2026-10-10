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

/** The journal's `SYSLOG_IDENTIFIER` for the Supervisor's container. */
export const supervisorIdentifier = "hassio_supervisor";

/**
 * Where the Supervisor's events come from, and the store's cursor key for
 * reading them. The Supervisor logs in the same format as Core, so its records
 * are read the same way.
 */
export const supervisorSource = "homeassistant-supervisor";

/**
 * Where apps' events come from, and the store's cursor key for reading them.
 * Every app's log is read together.
 */
export const appsSource = "homeassistant-apps";

/**
 * Where events from the Home Assistant host's own journal come from, such as
 * its kernel, systemd and NetworkManager, and the store's cursor key for
 * reading it.
 */
export const hostSource = "homeassistant-host";

/**
 * Whether a journal entry is the host's own rather than a container's. Docker
 * puts every container's stderr in the journal at error, but Core's, the
 * Supervisor's, its plugins' and apps' are read as their own logs, so reading
 * them as the host's too would collect them twice.
 */
export const isHostEntry = (entry: Entry) =>
  text(entry, "CONTAINER_NAME") === undefined;

/**
 * Where the Supervisor's plugins' events come from, such as DNS and audio, and
 * the store's cursor key for reading them. Every plugin's log is read
 * together.
 */
export const pluginsSource = "homeassistant-plugins";

/**
 * Whether a journal identifier is one of the Supervisor's plugins'
 * containers, such as `hassio_dns`, but not the Supervisor's own.
 */
export const isPlugin = (identifier: string) =>
  /^hassio_./.test(identifier) && identifier !== supervisorIdentifier;

/**
 * Whether a journal identifier is an app's container, `app_<slug>`, or
 * `addon_<slug>` on older Supervisors.
 */
export const isApp = (identifier: string) =>
  /^(?:app|addon)_./.test(identifier);

/**
 * Whether a journal identifier is the app running on `hostname`, such as
 * triage's own. The Supervisor names an app's container `app_<slug>` and its
 * host `<slug>` with `-` for `_`, but a slug can have `-` in it too.
 */
export const isAppOn = (identifier: string, hostname: string) =>
  hostname !== "" &&
  identifier.replace(/^(?:app|addon)_/, "").replace(/-/g, "_") ===
    hostname.replace(/-/g, "_");

/** Terminal colour codes, which these logs have even when they aren't a terminal. */
const colours = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

/**
 * The start of a Core log record, in Core's own format:
 * `2026-10-10 12:00:00.123 ERROR (MainThread) [homeassistant.core] Message`.
 */
const recordStart =
  /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)? (?<level>[A-Z]+) \(.*?\) \[(?<logger>[^\]]+)\] (?<message>.*)$/s;

/** A level below warning, which starts a record that triage leaves out. */
const below = "below";

/**
 * The severity of a log level, or {@link below} for one below warning, or
 * nothing when it isn't a level. Single letters, as in OpenThread's `[W]` or
 * PulseAudio's `W:`, only count when they're marked out, in brackets or
 * before a colon.
 */
const levelOf = (
  level: string,
  marked: boolean,
): Severity.Severity | typeof below | undefined => {
  const upper = level.toUpperCase();

  if (upper.length === 1 && !marked) {
    return undefined;
  }

  switch (upper) {
    case "EMERG":
    case "ALERT":
    case "FATAL":
    case "CRITICAL":
    case "CRIT":
    case "C":
      return "crit";
    case "ERROR":
    case "ERR":
    case "E":
      return "err";
    case "WARNING":
    case "WARN":
    case "WRN":
    case "W":
      return "warning";
    case "NOTICE":
    case "INFO":
    case "INF":
    case "N":
    case "I":
    case "DEBUG":
    case "DBG":
    case "D":
    case "TRACE":
    case "TRC":
    case "T":
      return below;
    default:
      return undefined;
  }
};

/**
 * A line in another program's format with a level near its start, after up
 * to two timestamp-like words: `[12:00:00] ERROR: Message` from `bashio`,
 * `2026-10-10 12:00:00 WRN Message`, `3d.08:40:51.599 [W] Mle-: Message`,
 * `E: [pulseaudio] Message` or `[ERROR] plugin/errors: Message`. A word only
 * counts as a level in brackets, in capitals or before a colon, so
 * `Error connecting` doesn't.
 */
const levelLine =
  /^(?:\S*\d\S*\s+){0,2}(?:\[(?<bracketed>[A-Za-z]+)\]|(?<word>[A-Za-z]+)(?<colon>:)?)(?:\s+|$)(?<message>.*)$/s;

const otherFormat = (line: string) => {
  const match = levelLine.exec(line)?.groups;

  if (match === undefined) {
    return undefined;
  }

  const word = match.word;

  const level =
    match.bracketed === undefined
      ? word !== undefined &&
        (word === word.toUpperCase() || match.colon !== undefined)
        ? levelOf(word, match.colon !== undefined)
        : undefined
      : levelOf(match.bracketed, true);

  return level === undefined
    ? undefined
    : { level, message: (match.message ?? "").trim() };
};

const lineOf = (entry: Entry) =>
  (text(entry, "MESSAGE") ?? "").replace(colours, "");

const programOf = (entry: Entry) =>
  text(entry, "SYSLOG_IDENTIFIER") ?? coreIdentifier;

/** How to read a log's lines. */
export interface Formats {
  /**
   * Also read lines in other programs' formats, as apps write them, each one
   * on its own. Lines in Core's format still take the lines that follow them.
   */
  readonly other?: boolean;
}

const startsRecord = (line: string, formats: Formats) =>
  recordStart.test(line) ||
  (formats.other === true && otherFormat(line) !== undefined);

/**
 * Where the last record starts in `entries`, or `undefined` when none does.
 * The lines from there on may be followed by more of its traceback.
 */
export const lastRecordStart = (
  entries: ReadonlyArray<Entry>,
  formats: Formats = {},
): number | undefined => {
  const index = entries.findLastIndex((entry) =>
    startsRecord(lineOf(entry), formats),
  );

  return index === -1 ? undefined : index;
};

/** One record, with the lines that followed it, such as a traceback. */
export interface LogRecord {
  /** The journal entry that started it. */
  readonly entry: Entry;
  /** The program that wrote it, by its journal identifier, such as an app's. */
  readonly program: string;
  readonly severity: Severity.Severity;
  /**
   * The logger that logged it, such as `homeassistant.components.hue`, or
   * the program when reading other formats, as for apps, whose own logger, if
   * any, starts the message instead.
   */
  readonly logger: string;
  /** Its message, then any lines that followed it. */
  readonly lines: ReadonlyArray<string>;
}

/**
 * Group a log's journal entries into records. The journal holds one entry per
 * line written, so a traceback's lines follow the record that logged it, from
 * the same program. Records below warning are left out, and so are lines
 * before a program's first record, such as the end of a traceback that
 * started in an earlier batch, and lines in no format triage knows.
 */
export const recordsOf = (
  entries: ReadonlyArray<Entry>,
  formats: Formats = {},
): ReadonlyArray<LogRecord> => {
  const records: Array<{
    entry: Entry;
    program: string;
    severity: Severity.Severity | typeof below;
    logger: string;
    lines: Array<string>;
  }> = [];

  // The record each program's next lines carry on, while it can.
  const open = new Map<string, { lines: Array<string> }>();

  for (const entry of entries) {
    const line = lineOf(entry);
    const program = programOf(entry);
    const start = recordStart.exec(line)?.groups;

    if (start !== undefined) {
      const logger = start.logger ?? program;
      const message = start.message ?? "";

      // An app in Core's format is still named by the app, with its own
      // logger kept in the message, so its loggers group apart.
      const record = {
        entry,
        program,
        severity: levelOf(start.level ?? "", false) ?? below,
        logger: formats.other === true ? program : logger,
        lines: [formats.other === true ? `[${logger}] ${message}` : message],
      };

      records.push(record);
      open.set(program, record);

      continue;
    }

    const other = formats.other === true ? otherFormat(line) : undefined;

    if (other === undefined) {
      open.get(program)?.lines.push(line);

      continue;
    }

    records.push({
      entry,
      program,
      severity: other.level,
      logger: program,
      lines: [other.message],
    });
    open.delete(program);
  }

  return records.flatMap(({ severity, ...record }) =>
    severity === below ? [] : [{ ...record, severity }],
  );
};

/** How long before an error the log's other records are kept with it, in milliseconds. */
const breadcrumbMillis = 30_000;

/** The most of the log's earlier records kept with an error. */
const breadcrumbRecords = 10;

/**
 * The most earlier records kept to find breadcrumbs in, from every program
 * in the log, so a busy app doesn't push out a quieter one's.
 */
const recentRecords = 100;

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

const millisOf = (record: LogRecord) =>
  Math.floor(record.entry.__REALTIME_TIMESTAMP / 1000);

/** A record's first line, with its level and logger, as a breadcrumb. */
const breadcrumbOf = (record: LogRecord) =>
  `${levelNames[record.severity]} [${record.logger}] ${record.lines[0] ?? ""}`;

/**
 * Pair each record with what the same program logged in the
 * {@link breadcrumbMillis} before it, from any logger, oldest first, carrying
 * on from the records in `previous`. Returns the records to carry on from next
 * time too, since batches don't line up with what happened.
 */
export const withBreadcrumbs = (
  previous: ReadonlyArray<LogRecord>,
  records: ReadonlyArray<LogRecord>,
) => {
  let recent = previous;

  const paired = records.map((record) => {
    const at = millisOf(record);

    const breadcrumbs = recent
      .filter(
        (earlier) =>
          earlier.program === record.program &&
          at - millisOf(earlier) <= breadcrumbMillis,
      )
      .slice(-breadcrumbRecords)
      .map(breadcrumbOf);

    recent = [...recent, record].slice(-recentRecords);

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

const common = (record: LogRecord, host: string) => {
  const bootId = text(record.entry, "_BOOT_ID");

  return {
    host,
    bootId: bootId === undefined ? "" : Fingerprint.issueId(bootId),
    timestamp: Math.floor(record.entry.__REALTIME_TIMESTAMP / 1000),
  };
};

const unchanged: Redact = (text) => text;

/**
 * Turn a Core or Supervisor record at error or worse into a log error from its
 * logger, with any traceback after the message and what was logged just
 * before, or nothing for a warning. Redacted here, before it's stored, like
 * every other event, with Home Assistant's own names taken out of the message
 * by `redactNames` first.
 */
export const eventOf = (
  record: LogRecord,
  options: {
    readonly host: string;
    readonly redact: Redact;
    /** Where it was read from, Core's log unless given. */
    readonly source?: string;
    readonly breadcrumbs?: ReadonlyArray<string>;
    readonly redactNames?: Redact;
  },
): Event.Event | undefined => {
  if (record.severity === "warning") {
    return undefined;
  }

  const {
    host,
    redact,
    source = coreSource,
    breadcrumbs = [],
    redactNames = unchanged,
  } = options;

  const { bootId, ...rest } = common(record, host);
  const identifier = redact(record.logger);
  const integration = integrationOf(identifier);
  const redactText = (text: string) => redact(redactNames(text));

  return Event.Event.cases.LogError.make({
    ...rest,
    id: Fingerprint.issueId(record.entry.__CURSOR),
    source,
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

/**
 * Turn a Core or Supervisor record at warning into one occurrence of a warning
 * from its logger.
 */
export const warningOf = (
  record: LogRecord,
  host: string,
  redact: Redact,
  redactNames: Redact = unchanged,
): Warning.Warning | undefined => {
  // Only redacted once it's a warning, so a redaction token's value is only
  // kept for what's stored.
  if (record.severity !== "warning") {
    return undefined;
  }

  const example = redact(redactNames(record.lines[0] ?? ""));
  const template = Fingerprint.template(example);

  if (template === "") {
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
