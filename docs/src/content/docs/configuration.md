---
title: Configuration
description: Every triage setting, from the environment or an options file.
---

Every setting comes from an environment variable. The user services read theirs from `~/.config/triage/agent.env`, `server.env` and `worker.env`.

## Options file

Any setting can also come from a JSON file at `TRIAGE_OPTIONS`, with lowercase keys and no `TRIAGE_` prefix:

```json
{ "decide": true, "decide_daily": 10, "cloudflare_api_token": "..." }
```

Environment variables win over the file. The Home Assistant app uses this for its options.

## Hosts

| Variable | Default | |
| --- | --- | --- |
| `TRIAGE_SERVER` | none | The server's URL |
| `TRIAGE_TOKEN` | none | The host's token, from `triage hosts add` |
| `TRIAGE_REDACT_NAMES` | none | Other names to redact, comma-separated, such as a GitHub account |
| `TRIAGE_DB` | `$XDG_STATE_HOME/triage/triage.db` | The host's own store, which also holds events until they're sent |

## Server

| Variable | Default | |
| --- | --- | --- |
| `TRIAGE_HOSTNAME` | `127.0.0.1` (`::` in the container, IPv4 and IPv6) | Address to listen on |
| `TRIAGE_PORT` | `7171` | Port to listen on |
| `TRIAGE_SERVER_DB` | `$XDG_STATE_HOME/triage/server.db` (`/data/server.db` in the container) | Server database |
| `TRIAGE_TRUST_PROXY` | `false` | Trust `X-Forwarded-Host` and `X-Forwarded-For`. Only turn this on when the proxy is the only way to reach the server |
| `TRIAGE_SERVER_ADMIN_TOKEN` | none | An admin token the server always accepts, at least 32 characters, for managing tokens with `--server`. It isn't stored or listed |
| `TRIAGE_INGRESS_PORT` | none (`8099` in the Home Assistant app) | A second port for Home Assistant ingress, which treats every request as an admin's and only answers `TRIAGE_INGRESS_FROM`, and `TRIAGE_INGRESS_MCP_FROM` on `/mcp` |
| `TRIAGE_INGRESS_FROM` | `172.30.32.2`, Home Assistant's Supervisor | The address the ingress port answers |
| `TRIAGE_INGRESS_MCP_FROM` | `172.30.32.1`, Home Assistant Core | The address that may use the ingress port's [MCP server](/agents) at `/mcp` without a token |
| `TRIAGE_DECIDE_DAILY` | `100` | The most issues each decision model may decide on in any 24 hours, by the server and its workers together |
| `TRIAGE_SUGGEST_DAILY` | `5` | The most suggestions each language model may make in any 24 hours, by the server and its workers together |

## Workers and admins

| Variable | Default | |
| --- | --- | --- |
| `TRIAGE_SERVER` | none | The server's URL, which the token, issue, `decide` and `suggest` commands also use when `--server` is left out |
| `TRIAGE_WORKER_TOKEN` | none | The worker's token, from `triage workers add`, also used by `decide` and `suggest` on a remote server |
| `TRIAGE_ADMIN_TOKEN` | none | An admin token, for managing a server with `--server` or `TRIAGE_SERVER` on the token and issue commands |

## Models

These apply wherever the models run: `triage work`, `triage serve`, and the one-off `decide` and `suggest` commands.

| Variable | Default | |
| --- | --- | --- |
| `TRIAGE_DECIDE` | `false` | Ask a decision model about new issues every 5 minutes. The answers are only stored for now, to compare models |
| `TRIAGE_DECISION_PROVIDER` | `typesafe` | `typesafe` for any TypeSafe System One API, such as Ollaya or Ollama 0.35+, or `cloudflare` for Clef on Workers AI |
| `TRIAGE_DECISION_URL` | `http://127.0.0.1:11435/v1` (Ollaya) | The System One API, such as `http://127.0.0.1:11434/v1` for Ollama |
| `TRIAGE_DECISION_API_KEY` | none | Key for a hosted System One API, such as TypeSafe or OpenCode Zen |
| `TRIAGE_DECISION_MODEL` | `laya` through System One, `clef-flash` with Cloudflare | Decision model, such as `laya` or `winnow` on [Ollaya](https://ollaya.dev/library), or `nimble` on [Ollama](https://ollama.com/search?c=decision) |
| `TRIAGE_SUGGEST` | `false` | Suggest fixes every 15 minutes for issues the decision model rates worth fixing with at least 0.8 probability. Needs `TRIAGE_LLM_MODEL` |
| `TRIAGE_LLM_PROVIDER` | `openai` | `openai` for any OpenAI-compatible API, `anthropic` for any Anthropic-compatible one, or `cloudflare` for Workers AI |
| `TRIAGE_LLM_URL` | OpenAI's or Anthropic's own | The API, such as `https://openrouter.ai/api/v1`, `https://opencode.ai/zen/v1` or `http://127.0.0.1:11434/v1` for Ollama |
| `TRIAGE_LLM_API_KEY` | none | Key for the API, when it needs one |
| `TRIAGE_LLM_MODEL` | none | Language model for fix suggestions, such as `@cf/google/gemma-4-26b-a4b-it` on Workers AI |
| `CLOUDFLARE_ACCOUNT_ID` | none | Your Cloudflare account, for either provider set to `cloudflare` |
| `CLOUDFLARE_API_TOKEN` | none | A token with Workers AI access, for either provider set to `cloudflare` |

On the `serve` and `work` command lines, the language model settings are `--llm-provider`, `--llm-url` and `--llm-model`, since `--provider`, `--url` and `--model` are the decision model's.
