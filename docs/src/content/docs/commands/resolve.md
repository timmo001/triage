---
title: triage resolve
description: Arguments and flags for every triage resolve command.
sidebar:
  label: resolve
---

<!-- Generated from src/index.ts by `mise run docs:gen`. Do not edit by hand. -->

Every `triage resolve` command and its help, as `--help` prints it. Each also accepts the [global flags](/commands#global-flags).

## `triage resolve`

```text
DESCRIPTION
  Resolve issues once they're fixed. One that happens again opens as regressed, and is decided on again

USAGE
  triage resolve [flags] <issue...>

ARGUMENTS
  issue... string    The IDs of the issues

FLAGS
  --server string    Change the issues on the server at this URL, or $TRIAGE_SERVER, as the admin in $TRIAGE_ADMIN_TOKEN, instead of the server database on this machine
```
