---
title: triage issue
description: Arguments and flags for every triage issue command.
sidebar:
  label: issue
---

<!-- Generated from src/index.ts by `mise run docs:gen`. Do not edit by hand. -->

Every `triage issue` command and its help, as `--help` prints it. Each also accepts the [global flags](/commands#global-flags).

## `triage issue`

```text
DESCRIPTION
  Read one of the server's issues: its hosts, decisions, suggested fixes, notes, nearby issues and latest events

USAGE
  triage issue [flags] <issue>

ARGUMENTS
  issue string    The issue's ID, or a link to its page in triage's web UI

FLAGS
  --json             Print JSON
  --server string    Read the issue on the server at this URL, or $TRIAGE_SERVER, as the admin in $TRIAGE_ADMIN_TOKEN, instead of the server database on this machine
```
