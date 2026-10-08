---
title: Commands
description: Every triage command, argument and flag, generated from the CLI's help.
---

<!-- Generated from src/index.ts by `mise run docs:gen`. Do not edit by hand. -->

Each command has its own page with its help, as `triage <command> --help` prints it.

| Command | Alias |
| --- | --- |
| [`collect`](/commands/collect) | None |
| [`issues`](/commands/issues) | None |
| [`upload`](/commands/upload) | None |
| [`serve`](/commands/serve) | None |
| [`work`](/commands/work) | None |
| [`hosts`](/commands/hosts) | None |
| [`admins`](/commands/admins) | None |
| [`workers`](/commands/workers) | None |
| [`decide`](/commands/decide) | None |
| [`suggest`](/commands/suggest) | None |
| [`label`](/commands/label) | None |
| [`resolve`](/commands/resolve) | None |
| [`mute`](/commands/mute) | None |
| [`reopen`](/commands/reopen) | None |
| [`note`](/commands/note) | None |
| [`agreement`](/commands/agreement) | None |
| [`mcp`](/commands/mcp) | None |

## Global flags

```text
DESCRIPTION
  Capture crashes and errors from your machines, decide which are worth fixing, and suggest fixes

USAGE
  triage <subcommand> [flags]

GLOBAL FLAGS
  --help, -h                                                          Show help information
  --version, -v                                                       Show version information
  --wizard                                                            Start wizard mode for a command
  --completions <bash|zsh|fish|sh>                                    Print shell completion script (choices: bash, zsh, fish, sh)
  --log-level <all|trace|debug|info|warn|warning|error|fatal|none>    Sets the minimum log level (choices: all, trace, debug, info, warn, warning, error, fatal, none)

SUBCOMMANDS
  collect      Collect crashes, failures and errors from this machine's journal since the last run
  issues       List issues, most recently seen first
  upload       Send collected events to the server at $TRIAGE_SERVER, authenticating with $TRIAGE_TOKEN
  serve        Run the triage server over HTTP, which collects events from enrolled hosts. Use a reverse proxy or Cloudflare for HTTPS
  work         Decide on issues and suggest fixes for the server at $TRIAGE_SERVER, authenticating with $TRIAGE_WORKER_TOKEN, within the server's daily limits. Needs --decide, --suggest or both
  hosts        Manage the hosts that can send events
  admins       Manage the admins that can read issues and manage tokens
  workers      Manage the workers that can decide on issues and suggest fixes for this server
  decide       Ask a decision model whether the server's new issues are worth fixing, storing the answers without acting on them
  suggest      Ask a language model how to fix some of the server's issues, from their redacted events only, and store its suggestions
  label        Label one of the server's issues by hand, to measure decision models against
  resolve      Resolve issues once they're fixed. One that happens again opens as regressed, and is decided on again
  mute         Mute issues, so they're never decided on or suggested fixes for, however often they happen
  reopen       Reopen resolved or muted issues
  note         Add a note to one of the server's issues without changing its status
  agreement    Compare each decision model with the hand labels: how often it's sure enough to act on, and how often it's right when it is
  mcp          Serve MCP over stdio, so agents can find and read issues, their events and how similar issues were fixed, and resolve, mute, label or note on them
```
