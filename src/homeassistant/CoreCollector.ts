import { Effect, FileSystem, Layer, Option, Stream } from "effect";
import { type Entry, text } from "../journal/Entry.js";
import { Journal } from "../journal/Journal.js";
import { type Redact, Redactor } from "../redact.js";
import { Store } from "../store/Store.js";
import {
  coreEvent,
  coreIdentifier,
  coreRecords,
  coreWarning,
  lastRecordStart,
} from "./coreLog.js";

/** The store's cursor key for Core's entries in the host journal. */
const source = "homeassistant-core";

/** The most journal entries stored together. */
const batchSize = 1000;

/** Where the Supervisor mounts the host journal with `journald: true`. */
const journalDirectories = ["/var/log/journal", "/run/log/journal"];

/**
 * Collects Home Assistant Core's errors and warnings from the host journal the
 * Supervisor mounts into the app, straight into the server's own store, as
 * events from `host`. Runs in the background for as long as the layer, and
 * logs rather than failing when the journal isn't there or can't be read.
 */
export const layer = (options: { readonly host: string }) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const journal = yield* Journal;
      const store = yield* Store;
      const { redact, withHost } = yield* Redactor;

      const mounted = yield* Effect.forEach(journalDirectories, (directory) =>
        fs.exists(directory).pipe(Effect.orElseSucceed(() => false)),
      );

      if (!mounted.includes(true)) {
        return yield* Effect.logWarning(
          "Can't collect Home Assistant Core's errors: the host journal isn't mounted. Turn on journald for the app",
        );
      }

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

      const collect = Effect.gen(function* () {
        // journalctl --follow only reads the current boot, so catch up on
        // earlier boots with a plain read before following.
        for (const follow of [false, true]) {
          const after = yield* store.cursor(source);

          // A full batch means more entries are already waiting, so the last
          // record's traceback may go on in the next one. Hold it back until
          // then, and leave the cursor before it, so a restart reads it again.
          let carried: ReadonlyArray<Entry> = [];
          let collected = 0;

          yield* journal
            .read({
              after: Option.getOrUndefined(after),
              follow,
              identifier: coreIdentifier,
              merge: true,
            })
            .pipe(
              Stream.groupedWithin(batchSize, "1 second"),
              Stream.runForEach(
                Effect.fnUntraced(function* (batch) {
                  const all = [...carried, ...batch];

                  const split =
                    batch.length === batchSize
                      ? lastRecordStart(all) || all.length
                      : all.length;

                  const entries = all.slice(0, split);

                  carried = all.slice(split);

                  const last = entries.at(-1);

                  if (last === undefined) {
                    return;
                  }

                  const records = coreRecords(entries).map((record) => ({
                    record,
                    redact: redactFor(text(record.entry, "_HOSTNAME")),
                  }));

                  const added = yield* store.record(
                    source,
                    records.flatMap(({ record, redact }) => {
                      const event = coreEvent(record, options.host, redact);

                      return event === undefined ? [] : [event];
                    }),
                    last.__CURSOR,
                    records.flatMap(({ record, redact }) => {
                      const warning = coreWarning(record, options.host, redact);

                      return warning === undefined ? [] : [warning];
                    }),
                  );

                  collected += added;

                  if (follow && added > 0) {
                    yield* Effect.logInfo(
                      "Collected",
                      added,
                      "new Home Assistant Core errors",
                    );
                  }
                }),
              ),
            );

          if (!follow && collected > 0) {
            yield* Effect.logInfo(
              "Caught up on",
              collected,
              "new Home Assistant Core errors",
            );
          }
        }
      });

      yield* Effect.logInfo("Collecting Home Assistant Core's errors");

      // Following only stops when journalctl does, so start again after a
      // pause, from the saved cursor, whether it failed or not.
      yield* collect.pipe(
        Effect.catch((error) =>
          Effect.logWarning(
            `Couldn't collect Home Assistant Core's errors, retrying in a minute: ${error.message}`,
          ),
        ),
        Effect.andThen(Effect.sleep("1 minute")),
        Effect.forever,
        Effect.forkScoped,
      );
    }),
  );
