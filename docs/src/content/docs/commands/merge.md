---
title: triage merge
description: Arguments and flags for every triage merge command.
sidebar:
  label: merge
---

<!-- Generated from src/index.ts by `mise run docs:gen`. Do not edit by hand. -->

Every `triage merge` command and its help, as `--help` prints it. Each also accepts the [global flags](/commands#global-flags).

## `triage merge`

```text
DESCRIPTION
  Merge issues that are the same problem into the one seen first. The others' IDs lead to it, and unmerge splits them apart again

USAGE
  triage merge [flags] <issue...>

ARGUMENTS
  issue... string    The IDs of the issues

FLAGS
  --server string    Merge the issues on the server at this URL, or $TRIAGE_SERVER, as the admin in $TRIAGE_ADMIN_TOKEN, instead of the server database on this machine
```
