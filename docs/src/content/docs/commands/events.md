---
title: triage events
description: Arguments and flags for every triage events command.
sidebar:
  label: events
---

<!-- Generated from src/index.ts by `mise run docs:gen`. Do not edit by hand. -->

Every `triage events` command and its help, as `--help` prints it. Each also accepts the [global flags](/commands#global-flags).

## `triage events`

```text
DESCRIPTION
  Page through an issue's events, newest first

USAGE
  triage events [flags] <issue>

ARGUMENTS
  issue string    The issue's ID, or a link to its page in triage's web UI

FLAGS
  --limit, -n integer    The most events to show, up to 500
  --offset integer       How many of the newest events to skip
  --json                 Print JSON
  --server string        Read the events on the server at this URL, or $TRIAGE_SERVER, as the admin in $TRIAGE_ADMIN_TOKEN, instead of the server database on this machine
```
