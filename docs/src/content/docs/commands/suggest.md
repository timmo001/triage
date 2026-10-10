---
title: triage suggest
description: Arguments and flags for every triage suggest command.
sidebar:
  label: suggest
---

<!-- Generated from src/index.ts by `mise run docs:gen`. Do not edit by hand. -->

Every `triage suggest` command and its help, as `--help` prints it. Each also accepts the [global flags](/commands#global-flags).

## `triage suggest`

```text
DESCRIPTION
  Ask a language model how to fix some of the server's issues, from their redacted events only, and store its suggestions

USAGE
  triage suggest [flags] <issue...>

ARGUMENTS
  issue... string    The IDs of the issues to suggest fixes for

FLAGS
  --provider choice     Any OpenAI-compatible or Anthropic-compatible API at --url, or Workers AI with $CLOUDFLARE_ACCOUNT_ID and $CLOUDFLARE_API_TOKEN (choices: openai, anthropic, cloudflare)
  --url string          The API, such as https://openrouter.ai/api/v1 or https://opencode.ai/zen/v1, with $TRIAGE_LLM_API_KEY when it needs one. Defaults to OpenAI's or Anthropic's own
  --model, -m string    The language model, such as @cf/zai-org/glm-4.7-flash on Workers AI
  --llm-internal        Show the language model the values behind redaction tokens this machine keeps, such as device names, when its API is on this machine or its own network. Never for Cloudflare, or OpenAI's or Anthropic's own. Off unless set
  --json                Print JSON
  --server string       Suggest fixes for the server at this URL, or $TRIAGE_SERVER, as the worker in $TRIAGE_WORKER_TOKEN, instead of the server database on this machine
```
