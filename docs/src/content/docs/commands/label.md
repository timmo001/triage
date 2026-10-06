---
title: triage label
description: Arguments and flags for every triage label command.
sidebar:
  label: label
---

<!-- Generated from src/index.ts by `mise run docs:gen`. Do not edit by hand. -->

Every `triage label` command and its help, as `--help` prints it. Each also accepts the [global flags](/commands#global-flags).

## `triage label`

```text
DESCRIPTION
  Label one of the server's issues by hand, to measure decision models against

USAGE
  triage label [flags] <issue> <verdict>

ARGUMENTS
  issue string      The issue's ID
  verdict choice    worth: a real fault worth fixing; noise: expected, harmless or caused by the user
```
