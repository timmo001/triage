The server can now back up its own database while it runs, and restore one, from the web UI or the CLI. That makes moving a server to another machine a download and an upload.

## Backups

- **Make a backup** while the server runs, into a `backups` folder beside its database. It's a copy of the database, with every issue, event, host and token in it. The server's settings aren't in it.
- **Download, restore or delete** a kept backup, or **restore from a file**, such as a backup from another server. A restore checks the backup first, then the server starts again on it in its own process, keeping the database it replaced as `server.db.before-restore`.
- Only one backup or restore runs at a time.

See [Backups](https://triage.timmo.dev/setup/server#backups) and [Move a server](https://triage.timmo.dev/setup/server#move-a-server).

## Web UI

- **Backups** in the header opens a page to make, download, restore and delete backups, and to restore from a file. Downloads go through a link that works once, for 5 minutes. After a restore the page reloads once the server is back.

## CLI

- `triage backups list`, `create`, `download`, `remove`, `restore` and `upload`, with `--server` or `TRIAGE_SERVER`. Without one, they work on this machine's server database, and a restore goes in when the server next starts.

## Home Assistant app

- The app's own backups, in `/data/backups`, are left out of Home Assistant's backups of it, since they're copies already.
- Uploads stream through Home Assistant's ingress, so a large backup isn't held in memory on the way.

## Libraries

- `@timmo001/effect-triage` adds the `backups` and `backupDownloads` groups to `Api.Api`, with `Api.BackupFile`, `Api.BackupError` and `Api.UnknownBackup`.

**Full Changelog**: https://github.com/timmo001/triage/compare/0.25.0...0.26.0
