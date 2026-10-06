---
title: Add workers
description: Decide on issues and suggest fixes on a machine that has the models.
---

A worker runs the models for a server. It fetches issues from the server, asks its models about them and sends back the answers, so the models only need to be reachable from the worker. The server could be a small always-on box while a desktop with a GPU does the work.

## Enrol

On the server, or from anywhere with [`--server`](/setup/server#manage-tokens-remotely):

```bash
triage workers add desktop
```

## Run the worker

On the worker, put the server's URL, the printed token and the model settings in `~/.config/triage/worker.env`:

```bash
TRIAGE_SERVER=https://triage.example.com
TRIAGE_WORKER_TOKEN=...
TRIAGE_DECIDE=true
TRIAGE_DECISION_MODEL=winnow
```

then start it:

```bash
systemctl --user enable --now triage-worker.service
```

It runs `triage work`, which decides on new issues every 5 minutes with `TRIAGE_DECIDE`, and with `TRIAGE_SUGGEST` suggests fixes every 15 minutes for issues the configured decision model rated worth fixing with at least 0.8 probability. Turn on one or both. See [Configuration](/configuration#models) for the model settings and [Choices](/choices) for the models you can use.

## Limits

The server's daily limits, `TRIAGE_DECIDE_DAILY` and `TRIAGE_SUGGEST_DAILY`, cover the server and every worker together, so adding workers doesn't raise them. When a worker is off, nothing queues up: the next one to run picks up the same issues.

If the server or a model can't be reached, the worker logs a warning and tries again next time.

## On the server instead

The server can run the same loops itself with `triage serve --decide` or `--suggest`, or `TRIAGE_DECIDE` and `TRIAGE_SUGGEST` in `server.env`, when the models are reachable from there.
