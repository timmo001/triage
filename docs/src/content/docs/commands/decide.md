---
title: triage decide
description: Arguments and flags for every triage decide command.
sidebar:
  label: decide
---

<!-- Generated from src/index.ts by `mise run docs:gen`. Do not edit by hand. -->

Every `triage decide` command and its help, as `--help` prints it. Each also accepts the [global flags](/commands#global-flags).

## `triage decide`

```text
DESCRIPTION
  Ask a decision model whether the server's new issues are worth fixing, storing the answers without acting on them

USAGE
  triage decide [flags]

FLAGS
  --provider choice      Decide through any TypeSafe System One API, such as Ollaya or Ollama locally, or with Clef on Cloudflare using $CLOUDFLARE_ACCOUNT_ID and $CLOUDFLARE_API_TOKEN (choices: typesafe, cloudflare)
  --url string           The System One API: Ollaya by default, Ollama at http://127.0.0.1:11434/v1, or a hosted one with $TRIAGE_DECISION_API_KEY
  --model, -m string     The decision model: laya by default through System One, clef-flash with Cloudflare
  --limit, -n integer    The most issues to decide on
  --json                 Print JSON
```
