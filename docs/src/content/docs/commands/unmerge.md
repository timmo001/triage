---
title: triage unmerge
description: Arguments and flags for every triage unmerge command.
sidebar:
  label: unmerge
---

<!-- Generated from src/index.ts by `mise run docs:gen`. Do not edit by hand. -->

Every `triage unmerge` command and its help, as `--help` prints it. Each also accepts the [global flags](/commands#global-flags).

## `triage unmerge`

```text
DESCRIPTION
  Move a fingerprint's events out of a merged issue into an issue of their own, or list its fingerprints

USAGE
  triage unmerge [flags] <issue> [<fingerprint>]

ARGUMENTS
  issue string          The issue's ID
  fingerprint string    The fingerprint to move out. Leave it out to list the issue's fingerprints (optional)

FLAGS
  --server string    Unmerge the issue on the server at this URL, or $TRIAGE_SERVER, as the admin in $TRIAGE_ADMIN_TOKEN, instead of the server database on this machine
```
