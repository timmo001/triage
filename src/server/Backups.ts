/**
 * Backups of the server's store, kept in `backups` beside it: made with
 * `VACUUM INTO` while the server runs, downloaded, removed, and restored from
 * there or from an upload. One backup or restore runs at a time. A restore
 * checks the backup, stages it beside the store and restarts the server, which
 * swaps it in before it opens the store again (`applyPending`).
 */
import { SqliteClient } from "@effect/sql-sqlite-bun";
import { Api } from "@timmo001/effect-triage";
import {
  Clock,
  Context,
  DateTime,
  Duration,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Ref,
  Stream,
} from "effect";
import { SecureRandom } from "effect/crypto";
import { Base64Url } from "effect/encoding";
import { Reactivity } from "effect/reactivity";
import { latestMigration, serverStoreFile, Store } from "../store/Store.js";
import { Restart } from "./Restart.js";

/** What every backup's name ends in. */
export const extension = ".triage-backup";

/** The names of backups the server made, the only ones it reads or removes. */
const namePattern = /^triage-[\w-]+\.triage-backup$/;

/** How long a download link works for. */
const linkLife = Duration.minutes(5);

/** The files SQLite keeps a store in. */
const storeFiles = ["", "-wal", "-shm"];

/** Where a restore waits for the restart, beside the store. */
const stagedFile = (store: string) => `${store}.restore`;

/** Where the store a restore replaced is kept, beside it. */
const replacedFile = (store: string) => `${store}.before-restore`;

/** A backup on its way to a download. */
export interface Download {
  readonly name: string;
  readonly data: Stream.Stream<Uint8Array, Api.BackupError>;
}

/** The backups folder, beside the store. */
const folder = Effect.gen(function* () {
  const path = yield* Path.Path;

  return path.join(path.dirname(yield* serverStoreFile), "backups");
});

/**
 * Put a staged restore in place before the store opens: the store and its WAL
 * move aside as `server.db.before-restore`, replacing an older one, and the
 * backup takes their place.
 */
export const applyPending = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const store = yield* serverStoreFile;
  const staged = stagedFile(store);

  if (!(yield* fs.exists(staged))) {
    return;
  }

  yield* Effect.forEach(storeFiles, (suffix) =>
    Effect.gen(function* () {
      const replaced = replacedFile(store) + suffix;

      yield* fs.remove(replaced, { force: true });

      if (yield* fs.exists(store + suffix)) {
        yield* fs.rename(store + suffix, replaced);
      }
    }),
  );

  yield* fs.rename(staged, store);
  yield* Effect.logInfo(
    `Restored the store from a backup, keeping the one it replaced as ${replacedFile(store)}`,
  );
});

/**
 * Check `file` is a store this server can open: sound, with triage's
 * migrations, and none past the newest this server knows.
 */
const check = (file: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const sql = yield* SqliteClient.make({ filename: file, readonly: true });

      const [sound] = yield* sql<{ quick_check: string }>`PRAGMA quick_check`;

      if (sound?.quick_check !== "ok") {
        return yield* new Api.BackupError({
          message: "The backup is damaged",
        });
      }

      const [migrations] = yield* sql<{ latest: number | null }>`
        SELECT max(migration_id) AS latest FROM effect_sql_migrations
      `;

      const latest = migrations?.latest ?? null;

      if (latest === null) {
        return yield* new Api.BackupError({
          message: "The backup has no triage store in it",
        });
      }

      if (latest > latestMigration) {
        return yield* new Api.BackupError({
          message:
            "The backup is from a newer triage than this server: update the server first",
        });
      }
    }),
  ).pipe(
    Effect.provide(Reactivity.layer),
    Effect.catchTag("SqlError", () =>
      Effect.fail(
        new Api.BackupError({ message: "The backup isn't a triage store" }),
      ),
    ),
  );

export class Backups extends Context.Service<
  Backups,
  {
    /** The kept backups, newest first. */
    readonly list: Effect.Effect<ReadonlyArray<Api.BackupFile>>;
    /** Make a backup of the store in the backups folder. */
    readonly create: Effect.Effect<Api.BackupFile, Api.BackupError>;
    /** A kept backup, as it's stored. */
    readonly file: (name: string) => Effect.Effect<Download, Api.UnknownBackup>;
    /** A one-time code that downloads a kept backup, for 5 minutes. */
    readonly link: (name: string) => Effect.Effect<string, Api.UnknownBackup>;
    /** The backup a download code gives; the code then stops working. */
    readonly download: (
      code: string,
    ) => Effect.Effect<Download, Api.UnknownBackup>;
    readonly remove: (name: string) => Effect.Effect<void, Api.UnknownBackup>;
    /** Check a kept backup, then restore it, restarting the server. */
    readonly restore: (
      name: string,
    ) => Effect.Effect<void, Api.UnknownBackup | Api.BackupError>;
    /**
     * Keep the backup `data` carries, check it, then restore it, restarting
     * the server.
     */
    readonly upload: <E extends { readonly message: string }>(
      data: Stream.Stream<Uint8Array, E>,
    ) => Effect.Effect<void, Api.BackupError>;
  }
>()("triage/server/Backups") {
  static readonly layer = Layer.effect(
    Backups,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const store = yield* Store;
      const restart = yield* Restart;
      const random = yield* SecureRandom.SecureRandom;
      const file = yield* serverStoreFile;
      const backups = yield* folder;

      const busy = yield* Ref.make(false);

      const links = yield* Ref.make(
        new Map<string, { readonly name: string; readonly expires: number }>(),
      );

      // The server runs without it; making a backup then says why it can't
      yield* fs
        .makeDirectory(backups, { recursive: true })
        .pipe(
          Effect.catchTag("PlatformError", (error) =>
            Effect.logWarning(
              `Couldn't make the backups folder ${backups}: ${error.message}`,
            ),
          ),
        );

      // A backup or upload cut short last time leaves its part behind
      yield* Effect.forEach(
        yield* fs
          .readDirectory(backups)
          .pipe(Effect.orElseSucceed((): Array<string> => [])),
        (name) =>
          name.endsWith(".partial")
            ? fs.remove(path.join(backups, name)).pipe(Effect.ignore)
            : Effect.void,
      );

      /** Run `effect` as the one backup or restore, failing while another runs. */
      const exclusive = <A, E, R>(
        effect: Effect.Effect<A, E, R>,
      ): Effect.Effect<A, E | Api.BackupError, R> =>
        Ref.getAndSet(busy, true).pipe(
          Effect.flatMap((running): Effect.Effect<A, E | Api.BackupError, R> =>
            running
              ? Effect.fail(
                  new Api.BackupError({
                    message: "A backup or restore is already running",
                  }),
                )
              : effect.pipe(Effect.ensuring(Ref.set(busy, false))),
          ),
        );

      const failed = (message: string) => (cause: unknown) =>
        Effect.logWarning(message, cause).pipe(
          Effect.andThen(Effect.fail(new Api.BackupError({ message }))),
        );

      /** A new backup's name, from when it's made. */
      const newName = (kind: string) =>
        DateTime.now.pipe(
          Effect.map(
            (now) =>
              `triage-${kind}${DateTime.formatIso(now).slice(0, 19).replaceAll(":", "-")}${extension}`,
          ),
        );

      const describe = (name: string) =>
        fs.stat(path.join(backups, name)).pipe(
          Effect.map((info): Api.BackupFile => ({
            name,
            bytes: Number(info.size),
            at: Option.match(info.mtime, {
              onNone: () => 0,
              onSome: (date) => date.getTime(),
            }),
          })),
        );

      const unknown = (name: string) =>
        new Api.UnknownBackup({ message: `There's no backup called ${name}` });

      /** A kept backup's file, if `name` is one. */
      const kept = (name: string) =>
        Effect.gen(function* () {
          const found = path.join(backups, name);

          if (namePattern.test(name) && (yield* fs.exists(found))) {
            return found;
          }

          return yield* unknown(name);
        }).pipe(
          Effect.catchTag("PlatformError", () => Effect.fail(unknown(name))),
        );

      const asDownload = (name: string, found: string): Download => ({
        name,
        data: fs
          .stream(found)
          .pipe(
            Stream.mapError(
              (error) => new Api.BackupError({ message: error.message }),
            ),
          ),
      });

      /** Stage a checked backup beside the store, and restart onto it. */
      const stage = (found: string) =>
        Effect.gen(function* () {
          yield* check(found);

          const staged = stagedFile(file);

          yield* fs
            .copyFile(found, `${staged}.partial`)
            .pipe(Effect.catch(failed("Couldn't stage the backup")));
          yield* fs
            .rename(`${staged}.partial`, staged)
            .pipe(Effect.catch(failed("Couldn't stage the backup")));

          yield* Effect.logInfo(`Staged ${path.basename(found)} to restore`);
          yield* restart.request;
        });

      const list = Effect.gen(function* () {
        const names = (yield* fs
          .readDirectory(backups)
          .pipe(Effect.orElseSucceed((): Array<string> => []))).filter((name) =>
          namePattern.test(name),
        );

        const found = yield* Effect.forEach(
          names,
          (name) => describe(name).pipe(Effect.option),
          { concurrency: 8 },
        );

        return found
          .flatMap(Option.toArray)
          .toSorted((a, b) => b.at - a.at || b.name.localeCompare(a.name));
      });

      const create = exclusive(
        Effect.gen(function* () {
          const name = yield* newName("");
          const partial = path.join(backups, `${name}.partial`);

          yield* store
            .copyTo(partial)
            .pipe(Effect.catch(failed("Couldn't copy the store")));
          yield* fs
            .chmod(partial, 0o600)
            .pipe(Effect.catch(failed("Couldn't keep the backup")));
          yield* fs
            .rename(partial, path.join(backups, name))
            .pipe(Effect.catch(failed("Couldn't keep the backup")));

          const made = yield* describe(name).pipe(
            Effect.catch(failed("Couldn't read the backup")),
          );

          yield* Effect.logInfo(`Made ${name}, ${made.bytes} bytes`);

          return made;
        }),
      ).pipe(Effect.withSpan("Backups.create"));

      const link = Effect.fn("Backups.link")(function* (name: string) {
        yield* kept(name);

        const code = Base64Url.encode(yield* random.randomBytes(24));
        const now = yield* Clock.currentTimeMillis;

        yield* Ref.update(links, (all) =>
          new Map([...all].filter(([, each]) => each.expires > now)).set(code, {
            name,
            expires: now + Duration.toMillis(linkLife),
          }),
        );

        return code;
      });

      const download = Effect.fn("Backups.download")(function* (code: string) {
        const now = yield* Clock.currentTimeMillis;

        const found = yield* Ref.modify(links, (all) => {
          const next = new Map(all);

          next.delete(code);

          return [Option.fromUndefinedOr(all.get(code)), next];
        });

        if (Option.isNone(found) || found.value.expires <= now) {
          return yield* new Api.UnknownBackup({
            message: "That download link is used or past its time",
          });
        }

        return asDownload(found.value.name, yield* kept(found.value.name));
      });

      return Backups.of({
        list,
        create,
        file: (name) =>
          kept(name).pipe(Effect.map((found) => asDownload(name, found))),
        link,
        download,
        remove: (name) =>
          kept(name).pipe(
            Effect.flatMap((found) => fs.remove(found)),
            Effect.catchTag("PlatformError", () =>
              Effect.fail(
                new Api.UnknownBackup({ message: `Couldn't remove ${name}` }),
              ),
            ),
          ),
        restore: (name) =>
          exclusive(kept(name).pipe(Effect.flatMap(stage))).pipe(
            Effect.withSpan("Backups.restore"),
          ),
        upload: (data) =>
          exclusive(
            Effect.gen(function* () {
              const name = yield* newName("uploaded-");
              const found = path.join(backups, name);
              const partial = `${found}.partial`;

              const discard = fs
                .remove(partial, { force: true })
                .pipe(Effect.ignore);

              yield* Stream.run(
                data.pipe(
                  Stream.mapError(
                    (error) => new Api.BackupError({ message: error.message }),
                  ),
                ),
                fs.sink(partial, { mode: 0o600 }),
              ).pipe(
                Effect.catchTag(
                  "PlatformError",
                  failed("Couldn't keep the upload"),
                ),
                Effect.tapError(() => discard),
              );

              yield* check(partial).pipe(Effect.tapError(() => discard));
              yield* fs
                .rename(partial, found)
                .pipe(Effect.catch(failed("Couldn't keep the upload")));

              yield* stage(found);
            }),
          ).pipe(Effect.withSpan("Backups.upload")),
      });
    }),
  ).pipe(Layer.provide(SecureRandom.layerWebCrypto));
}
