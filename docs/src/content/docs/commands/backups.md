---
title: triage backups
description: Arguments and flags for every triage backups command.
sidebar:
  label: backups
---

<!-- Generated from src/index.ts by `mise run docs:gen`. Do not edit by hand. -->

Every `triage backups` command and its help, as `--help` prints it. Each also accepts the [global flags](/commands#global-flags).

## `triage backups`

```text
DESCRIPTION
  Back up the server's database while it runs, and download, remove or restore its backups

USAGE
  triage backups <subcommand> [flags]
```

## `triage backups list`

```text
DESCRIPTION
  List the backups kept on the server, newest first

USAGE
  triage backups list [flags]

FLAGS
  --json             Print JSON
  --server string    Manage the backups of the server at this URL, or $TRIAGE_SERVER, as the admin in $TRIAGE_ADMIN_TOKEN, instead of those beside the server database on this machine
```

## `triage backups create`

```text
DESCRIPTION
  Back up the server's database while it runs, keeping the backup on the server. Its settings aren't in it

USAGE
  triage backups create [flags]

FLAGS
  --json             Print JSON
  --server string    Manage the backups of the server at this URL, or $TRIAGE_SERVER, as the admin in $TRIAGE_ADMIN_TOKEN, instead of those beside the server database on this machine
```

## `triage backups download`

```text
DESCRIPTION
  Download a backup kept on the server

USAGE
  triage backups download [flags] <name>

ARGUMENTS
  name string    The backup's name on the server, from triage backups list

FLAGS
  --output, -o string    Where to save it; its own name here by default
  --server string        Manage the backups of the server at this URL, or $TRIAGE_SERVER, as the admin in $TRIAGE_ADMIN_TOKEN, instead of those beside the server database on this machine
```

## `triage backups remove`

```text
DESCRIPTION
  Remove a backup kept on the server

USAGE
  triage backups remove [flags] <name>

ARGUMENTS
  name string    The backup's name on the server, from triage backups list

FLAGS
  --server string    Manage the backups of the server at this URL, or $TRIAGE_SERVER, as the admin in $TRIAGE_ADMIN_TOKEN, instead of those beside the server database on this machine
```

## `triage backups restore`

```text
DESCRIPTION
  Restore a backup kept on the server, which checks it, then starts again on it

USAGE
  triage backups restore [flags] <name>

ARGUMENTS
  name string    The backup's name on the server, from triage backups list

FLAGS
  --server string    Manage the backups of the server at this URL, or $TRIAGE_SERVER, as the admin in $TRIAGE_ADMIN_TOKEN, instead of those beside the server database on this machine
```

## `triage backups upload`

```text
DESCRIPTION
  Restore a backup file from this machine, keeping it with the server's backups. The server checks it, then starts again on it

USAGE
  triage backups upload [flags] <file>

ARGUMENTS
  file string    The backup file on this machine

FLAGS
  --server string    Manage the backups of the server at this URL, or $TRIAGE_SERVER, as the admin in $TRIAGE_ADMIN_TOKEN, instead of those beside the server database on this machine
```
