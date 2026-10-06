---
title: triage hosts
description: Arguments and flags for every triage hosts command.
sidebar:
  label: hosts
---

<!-- Generated from src/index.ts by `mise run docs:gen`. Do not edit by hand. -->

Every `triage hosts` command and its help, as `--help` prints it. Each also accepts the [global flags](/commands#global-flags).

## `triage hosts`

```text
DESCRIPTION
  Manage the hosts that can send events

USAGE
  triage hosts <subcommand> [flags]
```

## `triage hosts add`

```text
DESCRIPTION
  Add a host and print its token

USAGE
  triage hosts add [flags] <name>

ARGUMENTS
  name string    A name for the host that doesn't identify the machine, such as desktop

FLAGS
  --server string    Manage the server at this URL as the admin in $TRIAGE_ADMIN_TOKEN, instead of the server database on this machine
```

## `triage hosts list`

```text
DESCRIPTION
  List each a host, oldest first

USAGE
  triage hosts list [flags]

FLAGS
  --json             Print JSON
  --server string    Manage the server at this URL as the admin in $TRIAGE_ADMIN_TOKEN, instead of the server database on this machine
```

## `triage hosts remove`

```text
DESCRIPTION
  Remove a host, revoking its token

USAGE
  triage hosts remove [flags] <name>

ARGUMENTS
  name string    A name for the host that doesn't identify the machine, such as desktop

FLAGS
  --server string    Manage the server at this URL as the admin in $TRIAGE_ADMIN_TOKEN, instead of the server database on this machine
```
