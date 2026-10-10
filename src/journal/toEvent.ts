import {
  Event,
  Fingerprint,
  Severity,
  type Warning,
} from "@timmo001/effect-triage";
import { Option } from "effect";
import type { Redact } from "../redact.js";
import { type Entry, type Field, text } from "./Entry.js";

/** systemd catalog message IDs, from `/usr/lib/systemd/catalog/systemd.catalog`. */
export const MessageId = {
  coredump: "fc2e22bc6ee647b6b90729ab34a250b1",
  unitFailed: "d9b373ed55a64feb8242e02dbe79a49c",
  kernelOom: "fe6faa94e7774663a0da52717891d8ef",
  systemdOomd: "d989611b15e44c9dbf31e3c81256e4ed",
} as const;

/**
 * A job failing to start a unit, logged at err alongside the unit's own
 * failure. Skipped so one failure doesn't count twice.
 */
const jobFailed = "be02cf6855d2428ba40df7e9d022f03d";

/** Catalog messages that become events, or are skipped as part of one. */
const eventMessageIds = new Set<string>([
  ...Object.values(MessageId),
  jobFailed,
]);

/** The most verbose journald priority captured as a log error: `err`. */
export const errorPriority = 3;

/** The journald priority counted as a warning: `warning`. */
export const warningPriority = 4;

const frameLine = /^#\d+\s+0x[0-9a-f]+\s+(\S+)\s+\(([^\s)]+)/i;

/**
 * Parse the crashing thread's stack trace from a systemd-coredump message,
 * innermost frame first.
 */
export const parseFrames = (
  message: string,
  redact: Redact,
): ReadonlyArray<Event.Frame> => {
  const [, crashing = ""] = message.split(/^Stack trace of thread \d+:$/m);
  const [thread = ""] = crashing.trimStart().split("\n\n");

  return thread.split("\n").flatMap((line) => {
    const match = frameLine.exec(line.trim());

    if (match === null) {
      return [];
    }

    const [, name = "n/a", module = ""] = match;

    return [
      {
        ...(name !== "n/a" && { function: name }),
        module: redact(module),
      },
    ];
  });
};

/** Where an entry names its unit, in order of preference. */
const unitFields: ReadonlyArray<readonly [Field, Scope]> = [
  ["USER_UNIT", "user"],
  ["UNIT", "system"],
  ["_SYSTEMD_USER_UNIT", "user"],
  ["_SYSTEMD_UNIT", "system"],
];

/** Where a coredump names the crashed process's unit. */
const crashUnitFields: ReadonlyArray<readonly [Field, Scope]> = [
  ["COREDUMP_USER_UNIT", "user"],
  ["COREDUMP_UNIT", "system"],
];

type Scope = "system" | "user";

/**
 * The unit an entry belongs to, unredacted, and the manager it runs in. Only
 * for reading more of this machine's journal: redact it before storing it.
 */
export const rawUnit = (
  entry: Entry,
): { readonly unit: string; readonly scope: Scope } | undefined => {
  const fields =
    text(entry, "MESSAGE_ID") === MessageId.coredump
      ? crashUnitFields
      : unitFields;

  for (const [field, scope] of fields) {
    const unit = text(entry, field);

    if (unit !== undefined) {
      return { unit, scope };
    }
  }

  return undefined;
};

/**
 * Turn a journal entry into a triage event, or nothing when it isn't a crash,
 * failure, OOM kill or error. Every text field is redacted here, before it is
 * stored or sent anywhere, and the journal cursor and boot ID are replaced
 * with hashes so events don't carry machine identifiers.
 */
export const toEvent = (
  entry: Entry,
  redact: Redact,
  /**
   * The host and source to give it, rather than the entry's redacted
   * hostname and `journal`, as for a journal read from inside an app.
   */
  from: { readonly host?: string; readonly source?: string } = {},
): Option.Option<Event.Event> => {
  const messageId = text(entry, "MESSAGE_ID");
  const priority = Number(text(entry, "PRIORITY") ?? errorPriority);
  const message = text(entry, "MESSAGE") ?? "";

  const redacted = (field: Field) => {
    const value = text(entry, field);

    return value === undefined ? undefined : redact(value);
  };

  const identifier = redacted("SYSLOG_IDENTIFIER");
  const bootId = text(entry, "_BOOT_ID");

  const common = {
    id: Fingerprint.issueId(entry.__CURSOR),
    host: from.host ?? redacted("_HOSTNAME") ?? "<host>",
    source: from.source ?? "journal",
    ...(bootId !== undefined && { bootId: Fingerprint.issueId(bootId) }),
    timestamp: Math.floor(entry.__REALTIME_TIMESTAMP / 1000),
    severity: Severity.fromPriority(priority) ?? "err",
    ...(identifier !== undefined && { identifier }),
    message: redact(message),
  };

  const found = rawUnit(entry);

  const unit =
    found === undefined ? {} : { unit: redact(found.unit), scope: found.scope };

  switch (messageId) {
    case MessageId.coredump: {
      const comm = redacted("COREDUMP_COMM");

      return Option.some(
        Event.Event.cases.Crash.make({
          ...common,
          ...(comm !== undefined && { identifier: comm }),
          ...unit,
          message: redact(message.split("\n")[0] ?? ""),
          executable: redacted("COREDUMP_EXE") ?? comm ?? "unknown",
          signal: redacted("COREDUMP_SIGNAL_NAME") ?? "unknown",
          frames: parseFrames(message, redact),
        }),
      );
    }

    case jobFailed:
      return Option.none();

    case MessageId.unitFailed: {
      const result = redacted("UNIT_RESULT");

      return Option.some(
        Event.Event.cases.UnitFailure.make({
          ...common,
          ...unit,
          ...(result !== undefined && { result }),
        }),
      );
    }

    case MessageId.kernelOom:
    case MessageId.systemdOomd: {
      const process = /\((?<name>[^)]+)\)/.exec(message)?.groups?.name;

      return Option.some(
        Event.Event.cases.OutOfMemory.make({
          ...common,
          ...unit,
          ...(process !== undefined && { process: redact(process) }),
        }),
      );
    }

    // Blank error lines, like the kernel's one each boot, carry nothing to triage.
    default:
      return priority <= errorPriority && message.trim() !== ""
        ? Option.some(
            Event.Event.cases.LogError.make({
              ...common,
              ...unit,
            }),
          )
        : Option.none();
  }
};

/**
 * Turn a journal entry logged at warning into one occurrence of a warning, or
 * nothing for any other entry. Kernel messages are left out, since the kernel
 * logs for everything, firewall blocks included, under one identifier. Like
 * events, every text field is redacted here and the boot ID is hashed.
 */
export const toWarning = (
  entry: Entry,
  redact: Redact,
  /** The host to give it, rather than the entry's redacted hostname. */
  from: { readonly host?: string } = {},
): Option.Option<Warning.Warning> => {
  const messageId = text(entry, "MESSAGE_ID") ?? "";
  const message = text(entry, "MESSAGE") ?? "";

  if (
    Number(text(entry, "PRIORITY")) !== warningPriority ||
    text(entry, "_TRANSPORT") === "kernel" ||
    eventMessageIds.has(messageId) ||
    message.trim() === ""
  ) {
    return Option.none();
  }

  const example = redact(message);
  const template = Fingerprint.template(example);
  const identifier = text(entry, "SYSLOG_IDENTIFIER");
  const unit = rawUnit(entry);

  if (template === "" || (identifier === undefined && unit === undefined)) {
    return Option.none();
  }

  const hostname = text(entry, "_HOSTNAME");
  const bootId = text(entry, "_BOOT_ID");
  const timestamp = Math.floor(entry.__REALTIME_TIMESTAMP / 1000);

  return Option.some({
    host: from.host ?? (hostname === undefined ? "<host>" : redact(hostname)),
    bootId: bootId === undefined ? "" : Fingerprint.issueId(bootId),
    ...(identifier !== undefined && { identifier: redact(identifier) }),
    ...(unit !== undefined && {
      unit: Fingerprint.unitTemplate(redact(unit.unit)),
    }),
    template,
    example,
    count: 1,
    firstSeen: timestamp,
    lastSeen: timestamp,
  });
};
