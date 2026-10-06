---
title: triage workers
description: Arguments and flags for every triage workers command.
sidebar:
  label: workers
---

<!-- Generated from src/index.ts by `mise run docs:gen`. Do not edit by hand. -->

Every `triage workers` command and its help, as `--help` prints it. Each also accepts the [global flags](/commands#global-flags).

## `triage workers`

```text
DESCRIPTION
  Manage the workers that can decide on issues and suggest fixes for this server

USAGE
  triage workers <subcommand> [flags]
```

## `triage workers add`

```text
DESCRIPTION
  Add a worker and print its token

USAGE
  triage workers add [flags] <name>

ARGUMENTS
  name string    A name for the worker that doesn't identify the machine, such as desktop

FLAGS
  --server string    Manage the server at this URL as the admin in $TRIAGE_ADMIN_TOKEN, instead of the server database on this machine
```

## `triage workers list`

```text
DESCRIPTION
  List the workers, oldest first

USAGE
  triage workers list [flags]

FLAGS
  --json             Print JSON
  --server string    Manage the server at this URL as the admin in $TRIAGE_ADMIN_TOKEN, instead of the server database on this machine
```

## `triage workers remove`

```text
DESCRIPTION
  Remove a worker, revoking its token

USAGE
  triage workers remove [flags] <name>

ARGUMENTS
  name string    A name for the worker that doesn't identify the machine, such as desktop

FLAGS
  --server string    Manage the server at this URL as the admin in $TRIAGE_ADMIN_TOKEN, instead of the server database on this machine
```
