---
title: triage similar
description: Arguments and flags for every triage similar command.
sidebar:
  label: similar
---

<!-- Generated from src/index.ts by `mise run docs:gen`. Do not edit by hand. -->

Every `triage similar` command and its help, as `--help` prints it. Each also accepts the [global flags](/commands#global-flags).

## `triage similar`

```text
DESCRIPTION
  Find issues like one of the server's issues, with their suggested fixes and notes, resolved ones first

USAGE
  triage similar [flags] <issue>

ARGUMENTS
  issue string    The issue's ID, or a link to its page in triage's web UI

FLAGS
  --limit, -n integer    The most issues to show, up to 50
  --json                 Print JSON
  --server string        Read the issues on the server at this URL, or $TRIAGE_SERVER, as the admin in $TRIAGE_ADMIN_TOKEN, instead of the server database on this machine
```
