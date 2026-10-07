---
title: triage mcp
description: Arguments and flags for every triage mcp command.
sidebar:
  label: mcp
---

<!-- Generated from src/index.ts by `mise run docs:gen`. Do not edit by hand. -->

Every `triage mcp` command and its help, as `--help` prints it. Each also accepts the [global flags](/commands#global-flags).

## `triage mcp`

```text
DESCRIPTION
  Serve MCP over stdio, so agents can find and read issues, their events and how similar issues were fixed, and resolve, mute or label them

USAGE
  triage mcp [flags]

FLAGS
  --server string    Read issues from the server at this URL, or $TRIAGE_SERVER, as the admin in $TRIAGE_ADMIN_TOKEN, instead of the server database on this machine
```
