---
title: Issues
description: How events become issues, the states an issue goes through, and how decision models are measured.
---

Triage groups events into issues by what went wrong, not when:

- Crashes group by executable and signal, plus their top stack frames when there are any.
- Failed units group by unit and how they failed. Transient scopes, `systemd-run` units, session scopes and units with numbered instances each group as one.
- Out-of-memory kills group by the process that was killed, on each host.
- Errors group by the program that logged them and the message, with its numbers, paths, IDs and addresses taken out, on each host.

A crash or failed unit on two hosts is one issue, with events from both, and its page shows how often it happened on each. Errors and OOM kills stay separate for each host, since the same message often has a cause particular to that machine.

```bash
triage issues            # this host's issues
triage issues --server   # the server's
```

`--server` lists the issues of the server at `TRIAGE_SERVER`, as the admin in `TRIAGE_ADMIN_TOKEN`, or the server database on this machine when `TRIAGE_SERVER` isn't set.

## States

| State     | Means                                                              |
| --------- | ------------------------------------------------------------------ |
| New       | First seen in the last week                                        |
| Ongoing   | Seen before that, and still happening in the last week             |
| Quiet     | Still open, but nothing in the last week                           |
| Regressed | Happened again after it was resolved, in the last week             |
| Resolved  | Fixed, as far as you know                                          |
| Muted     | Hidden from decision and language models, however often it happens |

```bash
triage resolve <issue>...
triage mute <issue>...
triage reopen <issue>...
```

An event later than an issue's resolution reopens it as regressed, and decision models look at it again. A quiet issue that happens again goes back to ongoing; nothing is resolved for you. Add `--server <url>`, or set `TRIAGE_SERVER`, to change a remote server's issues as the admin in `TRIAGE_ADMIN_TOKEN`.

## In a browser

The server has a web page at its own URL, such as `http://localhost:7171/`. It lists the server's issues with the hosts each happened on, loading more as you scroll. Search their titles, sort them by when they were last or first seen, how likely the latest decision says they're worth fixing, how many events they have or their title, and group them by state, kind or label. Groups collapse, and the page remembers which ones you collapsed.

**Filters** opens a panel with lists of states, hosts, kinds and labels, with how many issues each has. States start with regressed, new and ongoing ticked, so quiet, resolved and muted issues stay out of the way; everything else starts ticked. Untick what you don't want to see, and each list's clear button goes back to how it started. The page remembers these choices in the browser.

Tick issues, or a whole group, to resolve, mute, reopen or label them together. To go through issues that have stopped happening, tick only **Quiet** in Filters and resolve or mute the ones you're done with. Each issue's page shows how often it happened on each host, its 20 latest events with where each came from, what each decision model made of it and which worker asked, any suggested fixes, and buttons to resolve, mute, reopen or unmute it.

Sign in with an [admin token](/setup/server#tokens). It's kept in that browser until you sign out. In the [Home Assistant app](/setup/server#home-assistant), open **Triage** in Home Assistant's sidebar instead, with no token needed.

## Decisions

A decision model answers three questions about each new or regressed issue: whether it's worth fixing, how severe it is and what likely caused it, each with probabilities. The answers are only stored for now, to compare models before they drive anything.

```bash
triage decide            # decide on the server's new issues now
```

## Labels and agreement

Label issues by hand to measure decision models against your own judgement, with the **Worth fixing** and **Noise** buttons on an issue's page or from the command line:

```bash
triage label <issue> worth
triage label <issue> noise
triage agreement
```

`agreement` shows, for each model, how many labelled issues it was sure about (worth at least 0.8 or at most 0.2), and how often it was right when it was.

`label` and `agreement` work on a remote server the same way as `resolve`, with `--server <url>` or `TRIAGE_SERVER` and an admin token. `decide` and `suggest` do too, as a [worker](/setup/workers) with `TRIAGE_WORKER_TOKEN`, so their answers count towards the server's daily limits.

## Suggestions

```bash
triage suggest <issue>...
```

asks a language model how to fix issues, and stores its answers. It sends the same trimmed, redacted description decision models get, plus the unit and the lines it logged before it failed, and caps each response at 4,096 tokens, thinking included. Each suggestion records the events it was based on.
