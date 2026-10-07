---
title: triage serve
description: Arguments and flags for every triage serve command.
sidebar:
  label: serve
---

<!-- Generated from src/index.ts by `mise run docs:gen`. Do not edit by hand. -->

Every `triage serve` command and its help, as `--help` prints it. Each also accepts the [global flags](/commands#global-flags).

## `triage serve`

```text
DESCRIPTION
  Run the triage server over HTTP, which collects events from enrolled hosts. Use a reverse proxy or Cloudflare for HTTPS

USAGE
  triage serve [flags]

FLAGS
  --hostname string            The address to listen on
  --port, -p integer           The port to listen on
  --trust-proxy                Trust X-Forwarded-Host and X-Forwarded-For from a reverse proxy; only when the proxy is the sole way in
  --ingress-port integer       A second port for Home Assistant ingress, which only answers --ingress-from, and --ingress-mcp-from on /mcp, and needs no admin token
  --ingress-from string        The only address the ingress port answers, Home Assistant's Supervisor
  --ingress-mcp-from string    The address Home Assistant Core reaches the ingress port from, which may use /mcp there without a token
  --decide-daily integer       The most issues each decision model may decide on in any 24 hours, here with --decide or by workers
  --suggest-daily integer      The most suggestions each language model may make in any 24 hours, here with --suggest or by workers
  --decide                     Ask a decision model about new issues every few minutes, keeping the answers without acting on them. Off unless set
  --provider choice            Decide through any TypeSafe System One API, such as Ollaya or Ollama locally, or with Clef on Cloudflare using $CLOUDFLARE_ACCOUNT_ID and $CLOUDFLARE_API_TOKEN (choices: typesafe, cloudflare)
  --url string                 The System One API: Ollaya by default, Ollama at http://127.0.0.1:11434/v1, or a hosted one with $TRIAGE_DECISION_API_KEY
  --model, -m string           The decision model: laya by default through System One, clef-flash with Cloudflare
  --suggest                    Ask a language model every 15 minutes how to fix issues the decision model clearly rates worth fixing, keeping its suggestions. Off unless set
  --llm-provider choice        Any OpenAI-compatible or Anthropic-compatible API at --llm-url, or Workers AI with $CLOUDFLARE_ACCOUNT_ID and $CLOUDFLARE_API_TOKEN (choices: openai, anthropic, cloudflare)
  --llm-url string             The API, such as https://openrouter.ai/api/v1 or https://opencode.ai/zen/v1, with $TRIAGE_LLM_API_KEY when it needs one. Defaults to OpenAI's or Anthropic's own
  --llm-model string           The language model, such as @cf/zai-org/glm-4.7-flash on Workers AI
```
