---
title: triage agent
description: Arguments and flags for every triage agent command.
sidebar:
  label: agent
---

<!-- Generated from src/index.ts by `mise run docs:gen`. Do not edit by hand. -->

Every `triage agent` command and its help, as `--help` prints it. Each also accepts the [global flags](/commands#global-flags).

## `triage agent`

```text
DESCRIPTION
  The Code Mode tools the OpenCode plugin registers, from the MCP server's issue tools

USAGE
  triage agent <subcommand> [flags]
```

## `triage agent tools`

```text
DESCRIPTION
  Print the Code Mode tools as JSON, and whether $TRIAGE_SERVER and $TRIAGE_ADMIN_TOKEN are set to call them with

USAGE
  triage agent tools [flags]

FLAGS
  --json    Print JSON (the only format)
```

## `triage agent call`

```text
DESCRIPTION
  Run a Code Mode tool with its input as JSON on stdin and print its result as JSON

USAGE
  triage agent call [flags] <tool>

ARGUMENTS
  tool choice    The tool to run, from triage agent tools

FLAGS
  --server string    Act on the server at this URL, or $TRIAGE_SERVER, as the admin in $TRIAGE_ADMIN_TOKEN, instead of the server database on this machine
```
