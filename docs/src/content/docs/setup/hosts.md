---
title: Add hosts
description: Collect crashes and errors from each machine and send them to the server.
---

A host is a machine triage collects from. It reads the journal, keeps crashes, failed units, out-of-memory kills and errors, redacts them and sends them to the server.

## Enrol

On the server, or from anywhere with [`--server`](/setup/server#manage-tokens-remotely), add the host by name:

```bash
triage hosts add laptop
```

The name is how the host shows up on the server, never its own hostname. Use lowercase letters, numbers and hyphens.

## Run the agent

On the host, put the server's URL and the printed token in `~/.config/triage/agent.env`:

```bash
TRIAGE_SERVER=https://triage.example.com
TRIAGE_TOKEN=...
```

then start the agent:

```bash
systemctl --user enable --now triage-agent.service
```

It runs `triage collect --follow --upload`. The first run reads the whole journal, then it follows new entries. The agent doesn't start until `agent.env` exists.

## Offline

Events are stored on the host first, and only marked sent once the server accepts them. When the server can't be reached, the agent logs a warning and keeps collecting; it sends the backlog once the server is back.

## Hide more names

Hosts redact their own hostname and every regular user's name. To hide other names, such as a GitHub account that shows up in repository URLs, add them to `agent.env`, comma-separated:

```bash
TRIAGE_REDACT_NAMES=octocat,my-org
```

See [Privacy](/privacy) for everything that's redacted.

## Without a server

`triage collect` on its own stores events on the host, and `triage issues` lists them. That's a good way to see what triage would send before you set anything else up.
