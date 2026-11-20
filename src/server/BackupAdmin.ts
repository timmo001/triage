import { Api, TriageClient } from "@timmo001/effect-triage-client";
import { Context, Effect, FileSystem, Layer, Schema, Stream } from "effect";
import { FetchHttpClient } from "effect/http";
import { Store } from "../store/Store.js";
import { adminToken } from "./adminToken.js";
import { Backups } from "./Backups.js";
import { Restart } from "./Restart.js";

/** The store or the server couldn't manage a backup. */
export class BackupAdminError extends Schema.TaggedError<BackupAdminError>()(
  "BackupAdminError",
  { cause: Schema.Defect() },
) {
  override get message() {
    return this.cause instanceof Error
      ? this.cause.message
      : String(this.cause);
  }
}

const toBackupAdminError = (cause: unknown) => new BackupAdminError({ cause });

const isBackupError = Schema.is(Api.BackupError);

const isUnknownBackup = Schema.is(Api.UnknownBackup);

/** Makes, lists, downloads, removes and restores a server's backups, here or over its API. */
export class BackupAdmin extends Context.Service<
  BackupAdmin,
  {
    readonly list: Effect.Effect<
      ReadonlyArray<Api.BackupFile>,
      BackupAdminError
    >;
    readonly create: Effect.Effect<
      Api.BackupFile,
      Api.BackupError | BackupAdminError
    >;
    /** Save a kept backup to `to` on this machine. */
    save(
      name: string,
      to: string,
    ): Effect.Effect<
      void,
      Api.UnknownBackup | Api.BackupError | BackupAdminError
    >;
    remove(
      name: string,
    ): Effect.Effect<void, Api.UnknownBackup | BackupAdminError>;
    /** Restore a kept backup. */
    restore(
      name: string,
    ): Effect.Effect<
      void,
      Api.UnknownBackup | Api.BackupError | BackupAdminError
    >;
    /** Restore the backup in the file `from` on this machine. */
    upload(
      from: string,
    ): Effect.Effect<void, Api.BackupError | BackupAdminError>;
    /**
     * Whether a restore restarts the server at once. Here, it waits for the
     * server's next start instead.
     */
    readonly restarts: boolean;
  }
>()("triage/server/BackupAdmin") {
  /**
   * The backups beside this machine's server database. A restore is checked
   * and staged, and the server puts it in place when it next starts.
   */
  static readonly layerLocal = Layer.effect(
    BackupAdmin,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const backups = yield* Backups;

      return BackupAdmin.of({
        list: backups.list,
        create: backups.create,
        save: (name, to) =>
          backups.file(name).pipe(
            Effect.flatMap((download) =>
              Stream.run(download.data, fs.sink(to)),
            ),
            Effect.catchTag("PlatformError", (error) =>
              Effect.fail(toBackupAdminError(error)),
            ),
          ),
        remove: backups.remove,
        restore: backups.restore,
        upload: (from) => backups.upload(fs.stream(from)),
        restarts: false,
      });
    }),
  ).pipe(
    Layer.provide(Backups.layer),
    Layer.provide(Layer.succeed(Restart, Restart.of({ request: Effect.void }))),
    Layer.provide(Store.layerServer),
  );

  /** The backups of the server at `url`, as the admin in `$TRIAGE_ADMIN_TOKEN`. */
  static readonly layerRemote = (url: string) =>
    Layer.unwrap(
      Effect.gen(function* () {
        const token = yield* adminToken;

        return Layer.effect(
          BackupAdmin,
          Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            const client = yield* TriageClient;

            return BackupAdmin.of({
              list: client.backups
                .list()
                .pipe(Effect.mapError(toBackupAdminError)),
              create: client.backups
                .create()
                .pipe(
                  Effect.mapError((error) =>
                    isBackupError(error) ? error : toBackupAdminError(error),
                  ),
                ),
              save: (name, to) =>
                client.backups.file({ params: { name } }).pipe(
                  Effect.flatMap((response) =>
                    Stream.run(response.body, fs.sink(to)),
                  ),
                  Effect.mapError((error) =>
                    isUnknownBackup(error) ? error : toBackupAdminError(error),
                  ),
                ),
              remove: (name) =>
                client.backups
                  .remove({ params: { name } })
                  .pipe(
                    Effect.mapError((error) =>
                      isUnknownBackup(error)
                        ? error
                        : toBackupAdminError(error),
                    ),
                  ),
              restore: (name) =>
                client.backups
                  .restore({ params: { name } })
                  .pipe(
                    Effect.mapError((error) =>
                      isUnknownBackup(error) || isBackupError(error)
                        ? error
                        : toBackupAdminError(error),
                    ),
                  ),
              upload: (from) =>
                client.backups
                  .upload({ payload: fs.stream(from) })
                  .pipe(
                    Effect.mapError((error) =>
                      isBackupError(error) ? error : toBackupAdminError(error),
                    ),
                  ),
              restarts: true,
            });
          }),
        ).pipe(
          Layer.provide(TriageClient.layer({ url, token })),
          Layer.provide(FetchHttpClient.layer),
        );
      }),
    );
}
