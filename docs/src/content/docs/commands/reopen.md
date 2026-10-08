---
title: triage reopen
description: Arguments and flags for every triage reopen command.
sidebar:
  label: reopen
---

<!-- Generated from src/index.ts by `mise run docs:gen`. Do not edit by hand. -->

Every `triage reopen` command and its help, as `--help` prints it. Each also accepts the [global flags](/commands#global-flags).

## `triage reopen`

```text
DESCRIPTION
  Reopen resolved or muted issues

USAGE
  triage reopen [flags] <issue...>

ARGUMENTS
  issue... string    The IDs of the issues

FLAGS
  --note, -m string    Why, kept in each issue's notes, such as why the fix didn't work
  --server string      Change the issues on the server at this URL, or $TRIAGE_SERVER, as the admin in $TRIAGE_ADMIN_TOKEN, instead of the server database on this machine
```
