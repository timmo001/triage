---
title: Plan your hardware
description: What each part of triage needs, and which machines give the best results.
---

Triage has four parts, and each one can run on whichever machine suits it. They need very different amounts of hardware, so it's worth deciding where each goes before you set anything up.

## At a glance

| Part | Where it runs | Needs | Best on |
| --- | --- | --- | --- |
| Collect | Every Linux machine you want to watch | systemd's journal, and very little CPU or memory | Each machine itself |
| Serve | One machine every host can reach | Little CPU or memory, a small SQLite database, and to stay on | A small always-on box, such as a Home Assistant Green, a home server or a VPS |
| Decide | The server or a worker | A decision model, which runs on a CPU, faster on an NVIDIA GPU, or hosted | A machine with an NVIDIA GPU, or Clef on Workers AI |
| Suggest | The server or a worker | A language model, on a GPU with plenty of memory or hosted | A hosted model, or a machine with a large GPU |

Decide and suggest are optional, and off until you turn them on. Collect and serve on their own already group everything into issues.

## Collect

The agent runs on each host as a user service. It follows the journal, so it needs systemd. Crashes come from systemd-coredump's entries, so they only show up where that's turned on. It uses very little CPU or memory, and keeps events on the host while the server is unreachable, so laptops that come and go are fine.

## Serve

The server stores events, groups them into issues and keeps the daily AI limits. It's light: it runs on a Home Assistant Green. What matters more is that it's always on and every host can reach it. Hosts hold on to their events while it's down, but nothing new shows up until it's back.

Small boards like the Green or Yellow can serve, but they're rarely up to running models, so leave decide and suggest to a [worker](/setup/workers) on those.

## Decide

A decision model reads each new issue and rates whether it's worth fixing. It never writes text, so it's quick and small. By Ollaya's figures:

| Model | NVIDIA GPU | CPU |
| --- | --- | --- |
| `laya` (the default) | About 10 ms | 0.2 to 0.4 s |
| `winnow:e4b` | About 90 ms | About 5 s |
| `clef` | About 0.5 s, needs 24 GB of video memory | Not practical |

The daily limit is 20 issues by default, so even a CPU keeps up with `laya`. With an NVIDIA GPU, `winnow:e4b` gives the most accurate answers for its speed. Without a GPU, or to try a larger model, Clef on Workers AI handles 20 a day within its free daily allowance.

## Suggest

A language model writes a suggested fix for the issues the decision model rates worth fixing. This is the heaviest part, and the one where the model you pick makes the most difference: bigger models give better suggestions.

- **Hosted**, such as OpenAI, Anthropic, OpenRouter, OpenCode Zen or Workers AI, needs no hardware and gives the best results, at that provider's prices.
- **Local**, through Ollama, LM Studio or llama.cpp, needs a GPU with enough memory for the model. A model that doesn't fit runs partly on the CPU and gets much slower.

Suggestions are limited to 5 a day by default and checked for every 15 minutes, so a slow local model still keeps up.

## Putting it together

| Setup | Serve | Decide and suggest |
| --- | --- | --- |
| Small box plus a desktop | A Home Assistant Green, home server or VPS | A desktop with a GPU, as a [worker](/setup/workers). Nothing queues up while it's off |
| One machine | A desktop or home server with a GPU | The same machine, with `triage serve --decide --suggest` |
| No GPU anywhere | Any always-on machine | `laya` on the CPU, or Clef on Workers AI, and a hosted language model |

Local models keep everything on your network. Hosted ones are only ever sent redacted events; see [Privacy](/privacy) for exactly what, and [Choices](/choices) for every option.
