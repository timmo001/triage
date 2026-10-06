---
title: triage admins
description: Arguments and flags for every triage admins command.
sidebar:
  label: admins
---

<!-- Generated from src/index.ts by `mise run docs:gen`. Do not edit by hand. -->

Every `triage admins` command and its help, as `--help` prints it. Each also accepts the [global flags](/commands#global-flags).

## `triage admins`

```text
DESCRIPTION
  Manage the admins that can read issues and manage tokens

USAGE
  triage admins <subcommand> [flags]
```

## `triage admins add`

```text
DESCRIPTION
  Add an admin and print its token

USAGE
  triage admins add [flags] <name>

ARGUMENTS
  name string    A name for the admin, such as aidan

FLAGS
  --server string    Manage the server at this URL as the admin in $TRIAGE_ADMIN_TOKEN, instead of the server database on this machine
```

## `triage admins list`

```text
DESCRIPTION
  List each an admin, oldest first

USAGE
  triage admins list [flags]

FLAGS
  --json             Print JSON
  --server string    Manage the server at this URL as the admin in $TRIAGE_ADMIN_TOKEN, instead of the server database on this machine
```

## `triage admins remove`

```text
DESCRIPTION
  Remove an admin, revoking its token

USAGE
  triage admins remove [flags] <name>

ARGUMENTS
  name string    A name for the admin, such as aidan

FLAGS
  --server string    Manage the server at this URL as the admin in $TRIAGE_ADMIN_TOKEN, instead of the server database on this machine
```
