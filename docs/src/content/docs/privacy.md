---
title: Privacy
description: What triage captures, what it redacts and where anything goes.
---

Triage reads your system journal, which holds a lot of personal detail. This explains what it keeps, what it removes and where anything goes. There's no triage service or account: everything runs on machines and services you choose, and nothing is sent to the developer.

## What's captured

Hosts read the systemd journal and keep only:

- crashes (systemd-coredump), with the crashing thread's function and library names
- unit failures
- out-of-memory kills, from the kernel and systemd-oomd
- anything logged at error priority or worse

For failures and crashes, hosts also keep the last 10 lines the unit logged before it, to give suggestions something to go on.

Hosts also count warnings, apart from the kernel's, by program and message with the parts that change, such as numbers and paths, replaced. They keep each count with the latest message for a week, and only send the counts for programs that have an issue that isn't muted. Warnings never become issues of their own.

Each event keeps its message, the program and unit that logged it, its severity and when it happened. Everything else in the journal entry is dropped.

For events from the current boot, hosts also add the OS name and version from `/etc/os-release`, the kernel release, and, where pacman knows it, the name and version of the package that owns the program, unit file or kernel. Older events don't get these, since the host could have been running something else then.

## What's redacted

Redaction happens on the host, when an event or warning is captured, before it's stored or sent anywhere. Every text field, including stack frames, the logged lines and warnings, goes through it. It replaces:

- passwords, tokens, API keys, `Bearer` credentials and the user name and password in a URL, as in `https://<redacted>@example.com`
- email addresses
- home directories, as `~`
- the machine's hostname and every regular user's name
- any other names in `TRIAGE_REDACT_NAMES`, comma-separated, such as a GitHub account that shows up in repository URLs
- IPv4 and IPv6 addresses
- MAC addresses
- UUIDs, account and list IDs, and other long hex or token-like strings
- serial numbers
- Wi-Fi network names

Personal details, such as an address, a MAC address, a user or host name or a Wi-Fi network, become a token with a short code, as in `<ip:71d0a3c2>`. The code comes from a key that's made on the machine that captured the event and never leaves it, so the same value always gets the same code there, but nothing elsewhere can work out the value from it. That machine also keeps the value behind each code, in its own database, and never sends it anywhere, so it can show you the real value later. Credentials, UUIDs, long IDs and home directories never become tokens: nothing keeps their values at all. Codes don't affect grouping, so `<ip:71d0a3c2>` groups like `<ip>`.

The journal cursor and boot ID are replaced with hashes, so events don't carry machine identifiers either. When the server receives events, it sets their host to the name you enrolled the host with, never the machine's own hostname.

The [Home Assistant app](/setup/server#home-assistant) redacts Home Assistant Core's errors and warnings the same way, as the host `home-assistant`, with the Home Assistant machine's hostname added. The default hostname, `homeassistant`, is kept: every install has it, and it's Core's own name, in every logger and path. The app also takes the names in Home Assistant's registries out of Core's messages: each entity ID's object ID becomes `<entity>`, keeping its domain, as in `light.<entity>`, and the names of devices, entities, areas, floors, people and your home become `<device>`, `<entity>`, `<area>`, `<floor>`, `<user>` and `<home>`. Names are matched with their case, so they don't replace parts of loggers and paths, and names under three characters are left alone. It reads only the registries for this, from the config directory Home Assistant mounts into it read only.

Redaction is pattern based, so it can miss something unusual. Run `triage collect`, then look through what it stored with `triage issues`, before turning on anything that sends data off the machine.

## Where data goes

| What | Where | What it sends |
| --- | --- | --- |
| Hosts | The triage server you set in `TRIAGE_SERVER` | Redacted events, and warning counts for programs with an issue |
| Server | Nowhere, unless you turn on decide or suggest | |
| Workers | The triage server they're enrolled with | Decisions and suggestions |
| Decision models, with `TRIAGE_DECIDE` | The decision model API you choose | A redacted description of the issue |
| Language models, with `TRIAGE_SUGGEST` or `triage suggest` | The language model API you choose | The same description, plus the unit or Home Assistant integration, its logged lines and the program's 5 most frequent warnings |
| Agents, through the [MCP server](/agents) | The agent you connect | An issue's redacted events and warnings, the names hosts were enrolled with, decisions and suggestions |

The description an issue sends is its kind, title and event count, up to 3 distinct messages and, for crashes, the top 5 stack frames. Messages and logged lines are cut at 300 characters. It never includes host names, event IDs or timestamps.

Nothing is sent to a model unless you turn decide or suggest on, or run `triage decide` or `triage suggest` yourself, and the automatic runs stop at their daily limits. With models on your own network, such as Ollaya or Ollama on a [worker](/setup/workers), nothing leaves your network at all. See [Choices](/choices) for where each option sends data.

## What the server stores

The server stores the redacted events, the issues they're grouped into, the warning counts hosts send, and any decisions and suggestions. It only holds the values behind tokens for events it captured itself, as the Home Assistant app does; hosts never send theirs. Tokens are stored as hashes, so the database doesn't hold a usable token. `TRIAGE_SERVER_ADMIN_TOKEN` isn't stored at all.
