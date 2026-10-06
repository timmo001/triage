---
title: Choices
description: Host triage and run its models wherever you like, local or hosted, with no vendor lock-in.
---

Triage doesn't tie you to any vendor. Every part can run on your own hardware or on a service you pick, and none of them is the intended one with the rest as fallbacks. Mix them however suits you: the server on one machine, decision models on another, and a hosted language model, or everything on one box with nothing leaving your network.

See [Privacy](/privacy) for exactly what each of them is sent, and [Configuration](/configuration#models) for the settings.

## Hosting the server

| Option | Where data goes | Cost |
| --- | --- | --- |
| Arch Linux user service | Your machine | Free |
| Container, with Docker Compose | Your machine, plus Cloudflare if you use a [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/) | Free |
| Home Assistant app | Your Home Assistant | Free |
| Cloudflare (planned) | Your Cloudflare account | [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) |

Hosts and workers only need the server's URL, so you can move it later without changing anything else.

## Decision models

Decision models decide which issues are worth fixing. Set `TRIAGE_DECISION_PROVIDER` to `typesafe` for any TypeSafe System One API, or `cloudflare` for Clef.

| Option | Where data goes | Cost |
| --- | --- | --- |
| [Ollaya](https://ollaya.dev/library), such as [`laya`](https://ollaya.dev/library/laya) or [`winnow`](https://ollaya.dev/library/winnow) | Your machine | Free |
| [Ollama](https://ollama.com/search?c=decision) 0.35 or later, such as [`nimble`](https://ollama.com/library/nimble) or [`tev1`](https://ollama.com/library/tev1) | Your machine | Free |
| [TypeSafe](https://typesafe.ai/)'s API | TypeSafe | TypeSafe's pricing |
| Jev on [OpenCode Zen](https://opencode.ai/docs/zen/) | OpenCode | [OpenCode Zen's pricing](https://opencode.ai/docs/zen/#pricing) |
| Clef on Cloudflare Workers AI, [`clef`](https://developers.cloudflare.com/workers-ai/models/clef/) or [`clef-flash`](https://developers.cloudflare.com/workers-ai/models/clef-flash/) | Your Cloudflare account | [Workers AI's](https://developers.cloudflare.com/workers-ai/platform/pricing/) free 10,000 Neurons a day, then its pricing |

## Language models

Language models suggest fixes. Set `TRIAGE_LLM_PROVIDER` to `openai` for any OpenAI-compatible API, `anthropic` for any Anthropic-compatible one, or `cloudflare` for Workers AI.

| Option | Where data goes | Cost |
| --- | --- | --- |
| [Ollama](https://ollama.com/library), [LM Studio](https://lmstudio.ai/models) or [llama.cpp](https://github.com/ggml-org/llama.cpp) | Your machine | Free |
| [OpenAI](https://developers.openai.com/api/docs/models) | OpenAI | [OpenAI's pricing](https://openai.com/business/pricing/#api) |
| [Anthropic](https://platform.claude.com/docs/en/models/overview) | Anthropic | [Anthropic's pricing](https://platform.claude.com/docs/en/about-claude/pricing) |
| [OpenRouter](https://openrouter.ai/models) | OpenRouter and the model's provider | Each model's price on OpenRouter |
| [OpenCode Zen](https://opencode.ai/docs/zen/), through either API | OpenCode | [OpenCode Zen's pricing](https://opencode.ai/docs/zen/#pricing) |
| [GitHub Models](https://docs.github.com/en/github-models) | GitHub | GitHub's free allowance, then its pricing |
| [Workers AI](https://developers.cloudflare.com/workers-ai/models/) | Your Cloudflare account | [Workers AI's](https://developers.cloudflare.com/workers-ai/platform/pricing/) free 10,000 Neurons a day, then its pricing |

One Ollama can serve both the decision model and the language model.

Planned:

- A coding agent such as OpenCode, Pi, Cursor, Claude Code, Codex, Copilot or Gemini, which reaches whatever providers it's set up with, such as a Copilot subscription you already have.
- Home Assistant's AI Task action, which uses whichever AI provider your Home Assistant is set up with.

## Limits

Decide and suggest are off until you turn them on, and stop at their daily limits (`TRIAGE_DECIDE_DAILY` and `TRIAGE_SUGGEST_DAILY`), shared by the server and all its workers. Each suggestion is capped at 4,096 tokens, so its cost stays predictable on any paid API.
