---
title: triage mute
description: Arguments and flags for every triage mute command.
sidebar:
  label: mute
---

<!-- Generated from src/index.ts by `mise run docs:gen`. Do not edit by hand. -->

Every `triage mute` command and its help, as `--help` prints it. Each also accepts the [global flags](/commands#global-flags).

## `triage mute`

```text
DESCRIPTION
  Mute issues, so they're never decided on or suggested fixes for, however often they happen

USAGE
  triage mute [flags] <issue...>

ARGUMENTS
  issue... string    The IDs of the issues

FLAGS
  --server string    Change the issues on the server at this URL, or $TRIAGE_SERVER, as the admin in $TRIAGE_ADMIN_TOKEN, instead of the server database on this machine
```
