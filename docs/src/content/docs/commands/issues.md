---
title: triage issues
description: Arguments and flags for every triage issues command.
sidebar:
  label: issues
---

<!-- Generated from src/index.ts by `mise run docs:gen`. Do not edit by hand. -->

Every `triage issues` command and its help, as `--help` prints it. Each also accepts the [global flags](/commands#global-flags).

## `triage issues`

```text
DESCRIPTION
  List issues, most recently seen first

USAGE
  triage issues [flags]

FLAGS
  --limit, -n integer    The most issues to show
  --offset integer       How many issues to skip first
  --search, -s string    Only issues whose title contains this, ignoring case
  --state choice         Only issues in this state. Repeat for several (choices: regressed, new, ongoing, quiet, resolved, muted)
  --kind choice          Only issues of this kind. Repeat for several (choices: Crash, UnitFailure, OutOfMemory, LogError)
  --host string          Only issues that happened on this host. Repeat for several
  --label choice         Only issues labelled worth or noise, or none for those without a label. Repeat for several (choices: worth, noise, none)
  --sort choice          What to sort by, lastSeen by default (choices: lastSeen, firstSeen, worth, count, title)
  --order choice         desc by default (choices: asc, desc)
  --server               List the server's issues: from $TRIAGE_SERVER as the admin in $TRIAGE_ADMIN_TOKEN when it's set, otherwise from $TRIAGE_SERVER_DB on this machine
  --json                 Print JSON
```
