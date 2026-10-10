import { Effect, FileSystem, Layer, Option, Stream } from "effect";
import { type Entry, text } from "../journal/Entry.js";
import { Journal } from "../journal/Journal.js";
import { type Redact, Redactor } from "../redact.js";
import { Store } from "../store/Store.js";
import { HomeAssistantConfig } from "./Config.js";
import {
  appsSource,
  coreIdentifier,
  coreSource,
  eventOf,
  type Formats,
  isApp,
  isAppOn,
  isPlugin,
  lastRecordStart,
  type LogRecord,
  pluginsSource,
  recordsOf,
  supervisorIdentifier,
  supervisorSource,
  warningOf,
  withBreadcrumbs,
} from "./log.js";
import { CollectionStatus } from "./Status.js";

/** The most journal entries stored together. */
const batchSize = 1000;

/** Where the Supervisor mounts the host journal with `journald: true`. */
const journalDirectories = ["/var/log/journal", "/run/log/journal"];

/**
 * How long to follow a log that's listed, such as every app's, before listing
 * it again, to pick up any installed since.
 */
const relisted = "1 hour";

/** A Home Assistant log in the host journal. */
export interface Log {
  /** The journal identifiers to read, when they're known. */
  readonly identifiers?: ReadonlyArray<string>;
  /**
   * Otherwise, which of the journal's identifiers to read, such as every
   * app's. triage's own is always left out.
   */
  readonly matches?: (identifier: string) => boolean;
  /** Where its events come from, and the store's cursor key for it. */
  readonly source: string;
  /** What the server's own log calls it. */
  readonly name: string;
  /** Whether its events get Core's version and custom integrations' details. */
  readonly attribute: boolean;
  readonly formats: Formats;
}

export const core: Log = {
  identifiers: [coreIdentifier],
  source: coreSource,
  name: "Home Assistant Core",
  attribute: true,
  formats: {},
};

export const supervisor: Log = {
  identifiers: [supervisorIdentifier],
  source: supervisorSource,
  name: "the Supervisor",
  attribute: false,
  formats: {},
};

export const plugins: Log = {
  matches: isPlugin,
  source: pluginsSource,
  name: "the Supervisor plugins",
  attribute: false,
  formats: { other: true },
};

export const apps: Log = {
  matches: isApp,
  source: appsSource,
  name: "apps",
  attribute: false,
  formats: { other: true },
};

/**
 * Collects errors and warnings from Home Assistant's `logs`, such as Core's,
 * the Supervisor's, its plugins' and apps', from the host journal the Supervisor mounts into the
 * app, straight into the server's own store, as events from `host`. Runs in
 * the background for as long as the layer, and logs rather than failing when
 * the journal isn't there or can't be read.
 */
export const layer = (options: {
  readonly host: string;
  readonly logs: ReadonlyArray<Log>;
}) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      if (options.logs.length === 0) {
        return;
      }

      const fs = yield* FileSystem.FileSystem;
      const journal = yield* Journal;
      const store = yield* Store;
      const { redact, withHost } = yield* Redactor;
      const config = yield* HomeAssistantConfig;
      const status = yield* CollectionStatus;

      const mounted = yield* Effect.forEach(journalDirectories, (directory) =>
        fs.exists(directory).pipe(Effect.orElseSucceed(() => false)),
      );

      if (!mounted.includes(true)) {
        yield* status.set("noJournal");

        return yield* Effect.logWarning(
          "Can't collect Home Assistant's errors: the host journal isn't mounted. Turn on journald for the app",
        );
      }

      if (!config.mounted) {
        yield* Effect.logWarning(
          "Can't redact Home Assistant's device, entity and area names from its errors, or add versions: its config directory isn't mounted",
        );
      }

      yield* status.set("collecting");

      // The journal names the host, which isn't this container, so redact
      // each entry's hostname as well as this machine's names. Home Assistant
      // OS's default, homeassistant, identifies nothing and is Core's package
      // name, in every logger and path, so it's kept.
      const hostRedacts = new Map<string, Redact>();

      const redactFor = (hostname: string | undefined) => {
        if (hostname === undefined || hostname === coreIdentifier) {
          return redact;
        }

        const existing = hostRedacts.get(hostname);

        if (existing !== undefined) {
          return existing;
        }

        const byHost = withHost(hostname);

        hostRedacts.set(hostname, byHost);

        return byHost;
      };

      // This app's own container, whose log is triage's and isn't collected.
      const hostname = (yield* fs
        .readFileString("/proc/sys/kernel/hostname")
        .pipe(Effect.orElseSucceed(() => ""))).trim();

      const identifiersOf = (log: Log) => {
        const matches = log.matches;

        return log.identifiers !== undefined || matches === undefined
          ? Effect.succeed(log.identifiers ?? [])
          : journal
              .identifiers({ merge: true })
              .pipe(
                Effect.map((all) =>
                  all.filter(
                    (identifier) =>
                      matches(identifier) && !isAppOn(identifier, hostname),
                  ),
                ),
              );
      };

      const collect = Effect.fnUntraced(function* (log: Log) {
        // journalctl --follow only reads the current boot, so catch up on
        // earlier boots with a plain read before following.
        for (const follow of [false, true]) {
          const identifiers = yield* identifiersOf(log);

          if (identifiers.length === 0) {
            return;
          }

          const after = yield* store.cursor(log.source);

          // A full batch means more entries are already waiting, so the last
          // record's traceback may go on in the next one. Hold it back until
          // then, and leave the cursor before it, so a restart reads it again.
          let carried: ReadonlyArray<Entry> = [];
          // The latest records, for what was logged before an error.
          let recent: ReadonlyArray<LogRecord> = [];
          let collected = 0;

          yield* journal
            .read({
              after: Option.getOrUndefined(after),
              follow,
              identifiers,
              merge: true,
            })
            .pipe(
              // A listed log, such as every app's, stops following now and
              // then, so it's listed again, and carries on from the saved
              // cursor.
              Stream.interruptWhen(
                follow && log.identifiers === undefined
                  ? Effect.sleep(relisted)
                  : Effect.never,
              ),
              Stream.groupedWithin(batchSize, "1 second"),
              Stream.runForEach(
                Effect.fnUntraced(function* (batch) {
                  const all = [...carried, ...batch];

                  const split =
                    batch.length === batchSize
                      ? lastRecordStart(all, log.formats) || all.length
                      : all.length;

                  const entries = all.slice(0, split);

                  carried = all.slice(split);

                  const last = entries.at(-1);

                  if (last === undefined) {
                    return;
                  }

                  const paired = withBreadcrumbs(
                    recent,
                    recordsOf(entries, log.formats),
                  );

                  recent = paired.recent;

                  const records = paired.records.map((pair) => ({
                    ...pair,
                    redact: redactFor(text(pair.record.entry, "_HOSTNAME")),
                  }));

                  const redactNames = yield* config.redactNames;

                  const events = yield* Effect.forEach(
                    records.flatMap(({ record, breadcrumbs, redact }) => {
                      const event = eventOf(record, {
                        host: options.host,
                        redact,
                        source: log.source,
                        breadcrumbs,
                        redactNames,
                      });

                      return event === undefined ? [] : [event];
                    }),
                    (event) =>
                      log.attribute
                        ? config.attribute(event)
                        : Effect.succeed(event),
                  );

                  const added = yield* store.record(
                    log.source,
                    events,
                    last.__CURSOR,
                    records.flatMap(({ record, redact }) => {
                      const warning = warningOf(
                        record,
                        options.host,
                        redact,
                        redactNames,
                      );

                      return warning === undefined ? [] : [warning];
                    }),
                  );

                  collected += added;

                  if (follow && added > 0) {
                    yield* Effect.logInfo(
                      `Collected ${added} new errors from ${log.name}`,
                    );
                  }
                }),
              ),
            );

          if (!follow && collected > 0) {
            yield* Effect.logInfo(
              `Caught up on ${collected} new errors from ${log.name}`,
            );
          }
        }
      });

      // Following only stops when journalctl does, or to list the apps again,
      // so start again after a pause, from the saved cursor, whether it failed
      // or not. With no apps yet, that's checking for one each minute.
      yield* Effect.forEach(
        options.logs,
        (log) =>
          Effect.logInfo(`Collecting errors from ${log.name}`).pipe(
            Effect.andThen(
              collect(log).pipe(
                Effect.catch((error) =>
                  Effect.logWarning(
                    `Couldn't collect errors from ${log.name}, retrying in a minute: ${error.message}`,
                  ),
                ),
                Effect.andThen(Effect.sleep("1 minute")),
                Effect.forever,
                Effect.forkScoped,
              ),
            ),
          ),
        { discard: true },
      );
    }),
  );
