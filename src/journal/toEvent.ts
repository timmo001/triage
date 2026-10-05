import { Event, Severity } from "@timmo001/effect-triage";
import { Option } from "effect";
import type { Redact } from "../redact.js";
import { type Entry, text } from "./Entry.js";

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

/** The most verbose journald priority captured as a log error: `err`. */
export const errorPriority = 3;

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

/**
 * Turn a journal entry into a triage event, or nothing when it isn't a crash,
 * failure, OOM kill or error. Text is redacted here, before it goes anywhere.
 */
export const toEvent = (
  entry: Entry,
  redact: Redact,
): Option.Option<Event.Event> => {
  const messageId = text(entry, "MESSAGE_ID");
  const priority = Number(text(entry, "PRIORITY") ?? errorPriority);
  const message = text(entry, "MESSAGE") ?? "";
  const identifier = text(entry, "SYSLOG_IDENTIFIER");
  const bootId = text(entry, "_BOOT_ID");

  const common = {
    id: entry.__CURSOR,
    host: text(entry, "_HOSTNAME") ?? "unknown",
    ...(bootId !== undefined && { bootId }),
    timestamp: Math.floor(entry.__REALTIME_TIMESTAMP / 1000),
    severity: Severity.fromPriority(priority) ?? "err",
    ...(identifier !== undefined && { identifier }),
    message: redact(message),
  };

  const unit =
    text(entry, "USER_UNIT") ??
    text(entry, "UNIT") ??
    text(entry, "_SYSTEMD_USER_UNIT") ??
    text(entry, "_SYSTEMD_UNIT");

  switch (messageId) {
    case MessageId.coredump: {
      const crashUnit =
        text(entry, "COREDUMP_USER_UNIT") ?? text(entry, "COREDUMP_UNIT");

      const comm = text(entry, "COREDUMP_COMM");

      return Option.some(
        Event.Event.cases.Crash.make({
          ...common,
          ...(comm !== undefined && { identifier: comm }),
          ...(crashUnit !== undefined && { unit: crashUnit }),
          message: redact(message.split("\n")[0] ?? ""),
          executable: redact(text(entry, "COREDUMP_EXE") ?? comm ?? "unknown"),
          signal: text(entry, "COREDUMP_SIGNAL_NAME") ?? "unknown",
          frames: parseFrames(message, redact),
        }),
      );
    }

    case jobFailed:
      return Option.none();

    case MessageId.unitFailed: {
      const result = text(entry, "UNIT_RESULT");

      return Option.some(
        Event.Event.cases.UnitFailure.make({
          ...common,
          ...(unit !== undefined && { unit }),
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
          ...(unit !== undefined && { unit }),
          ...(process !== undefined && { process }),
        }),
      );
    }

    default:
      return priority <= errorPriority
        ? Option.some(
            Event.Event.cases.LogError.make({
              ...common,
              ...(unit !== undefined && { unit }),
            }),
          )
        : Option.none();
  }
};
