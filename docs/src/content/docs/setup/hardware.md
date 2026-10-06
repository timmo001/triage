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
| Decide | The server or a worker | A decision model, on whatever's available: a GPU, a CPU or a hosted service | A GPU if you have one, otherwise a CPU or a hosted service |
| Suggest | The server or a worker | A language model, on a GPU with plenty of memory or a hosted service | A GPU with plenty of memory if you have one, otherwise a hosted service |

Decide and suggest are optional, and off until you turn them on. Collect and serve on their own already group everything into issues.

## Collect

The agent runs on each host as a user service. It follows the journal, so it needs systemd. Crashes come from systemd-coredump's entries, so they only show up where that's turned on. It uses very little CPU or memory, and keeps events on the host while the server is unreachable, so laptops that come and go are fine.

## Serve

The server stores events, groups them into issues and keeps the daily AI limits. It's light: it runs on a Home Assistant Green. What matters more is that it's always on and every host can reach it. Hosts hold on to their events while it's down, but nothing new shows up until it's back.

Small boards like the Green or Yellow can serve, but they're rarely up to running models, so leave decide and suggest to a [worker](/setup/workers) on those.

## Decide

A decision model reads each new issue and rates whether it's worth fixing. It never writes text, so it's quick and small, and runs on whatever you have:

- **A GPU** answers fastest and fits the more accurate models.
- **A CPU** is slower, but small models keep up easily: the daily limit is 20 issues by default.
- **A hosted service** needs no hardware at all, at that service's prices.

For a sense of scale, here are Ollaya's own figures for two of its models:

| Model | GPU | CPU |
| --- | --- | --- |
| `laya` (the default) | About 10 ms | 0.2 to 0.4 s |
| `winnow:e4b` | About 90 ms | About 5 s |

Ollaya is one option among several, local and hosted. See [Choices](/choices#decision-models) for all of them.

## Suggest

A language model writes a suggested fix for the issues the decision model rates worth fixing. This is the heaviest part, and the one where the model you pick makes the most difference: bigger models give better suggestions.

- **A GPU** with enough memory for the model runs one locally. A model that doesn't fit runs partly on the CPU and gets much slower.
- **A hosted service** needs no hardware, and offers models too large to run at home, at that service's prices.

Suggestions are limited to 5 a day by default and checked for every 15 minutes, so a slow local model still keeps up. More ways to suggest fixes are planned, such as a coding agent you already use or Home Assistant's AI Task; see [Choices](/choices#language-models).

## Putting it together

| Setup | Serve | Decide and suggest |
| --- | --- | --- |
| Small box plus a desktop | A Home Assistant Green, home server or VPS | A desktop with a GPU, as a [worker](/setup/workers). Nothing queues up while it's off |
| One machine | A desktop or home server with a GPU | The same machine, with `triage serve --decide --suggest` |
| No GPU anywhere | Any always-on machine | A small decision model on the CPU, or hosted, and a hosted language model |

Local models keep everything on your network. Hosted ones are only ever sent redacted events; see [Privacy](/privacy) for exactly what, and [Choices](/choices) for every option.
