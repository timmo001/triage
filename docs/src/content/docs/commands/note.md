---
title: triage note
description: Arguments and flags for every triage note command.
sidebar:
  label: note
---

<!-- Generated from src/index.ts by `mise run docs:gen`. Do not edit by hand. -->

Every `triage note` command and its help, as `--help` prints it. Each also accepts the [global flags](/commands#global-flags).

## `triage note`

```text
DESCRIPTION
  Add a note to one of the server's issues without changing its status

USAGE
  triage note [flags] <issue> <text>

ARGUMENTS
  issue string    The issue's ID
  text string     The note, in Markdown, such as what you found or a fix in progress. It's redacted like events

FLAGS
  --server string    Note on the issue on the server at this URL, or $TRIAGE_SERVER, as the admin in $TRIAGE_ADMIN_TOKEN, instead of the server database on this machine
```
