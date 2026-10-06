---
title: triage work
description: Arguments and flags for every triage work command.
sidebar:
  label: work
---

<!-- Generated from src/index.ts by `mise run docs:gen`. Do not edit by hand. -->

Every `triage work` command and its help, as `--help` prints it. Each also accepts the [global flags](/commands#global-flags).

## `triage work`

```text
DESCRIPTION
  Decide on issues and suggest fixes for the server at $TRIAGE_SERVER, authenticating with $TRIAGE_WORKER_TOKEN, within the server's daily limits. Needs --decide, --suggest or both

USAGE
  triage work [flags]

FLAGS
  --decide                 Ask a decision model about new issues every few minutes, keeping the answers without acting on them. Off unless set
  --provider choice        Decide through any TypeSafe System One API, such as Ollaya or Ollama locally, or with Clef on Cloudflare using $CLOUDFLARE_ACCOUNT_ID and $CLOUDFLARE_API_TOKEN (choices: typesafe, cloudflare)
  --url string             The System One API: Ollaya by default, Ollama at http://127.0.0.1:11434/v1, or a hosted one with $TRIAGE_DECISION_API_KEY
  --model, -m string       The decision model: laya by default through System One, clef-flash with Cloudflare
  --suggest                Ask a language model every 15 minutes how to fix issues the decision model clearly rates worth fixing, keeping its suggestions. Off unless set
  --llm-provider choice    Any OpenAI-compatible or Anthropic-compatible API at --llm-url, or Workers AI with $CLOUDFLARE_ACCOUNT_ID and $CLOUDFLARE_API_TOKEN (choices: openai, anthropic, cloudflare)
  --llm-url string         The API, such as https://openrouter.ai/api/v1 or https://opencode.ai/zen/v1, with $TRIAGE_LLM_API_KEY when it needs one. Defaults to OpenAI's or Anthropic's own
  --llm-model string       The language model, such as @cf/zai-org/glm-4.7-flash on Workers AI
```
