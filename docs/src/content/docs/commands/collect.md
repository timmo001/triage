---
title: triage collect
description: Arguments and flags for every triage collect command.
sidebar:
  label: collect
---

<!-- Generated from src/index.ts by `mise run docs:gen`. Do not edit by hand. -->

Every `triage collect` command and its help, as `--help` prints it. Each also accepts the [global flags](/commands#global-flags).

## `triage collect`

```text
DESCRIPTION
  Collect crashes, failures and errors from this machine's journal since the last run

USAGE
  triage collect [flags]

FLAGS
  --follow, -f    Keep collecting new entries as they're written
  --upload, -u    Send new events to $TRIAGE_SERVER after each batch, keeping them to retry when it can't be reached
  --json          Print JSON
```
