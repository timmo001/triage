---
title: Issues
description: How events become issues, the states an issue goes through, and how decision models are measured.
---

Triage groups events into issues by what went wrong, not when:

- Crashes group by executable and signal, plus their top stack frames when there are any.
- Failed units group by unit and how they failed. Transient scopes, `systemd-run` units, session scopes and units with numbered instances each group as one.
- Out-of-memory kills group by the process that was killed.
- Errors group by the program that logged them and the message, with its numbers, paths, IDs and addresses taken out.

An issue on two hosts is one issue, with events from both, and its page shows how often it happened on each.

```bash
triage issues            # this host's issues
triage issues --server   # the server's
```

`--server` lists the issues of the server at `TRIAGE_SERVER`, as the admin in `TRIAGE_ADMIN_TOKEN`, or the server database on this machine when `TRIAGE_SERVER` isn't set.

## States

| State     | Means                                                              |
| --------- | ------------------------------------------------------------------ |
| New       | First seen in the last 24 hours                                    |
| Ongoing   | Seen before that, and still happening in the last 72 hours         |
| Quiet     | Still open, but nothing in the last 72 hours                       |
| Regressed | Happened again after it was resolved, in the last 72 hours         |
| Resolved  | Fixed, as far as you know                                          |
| Muted     | Hidden from decision and language models, however often it happens |

The 24 and 72 hours are the defaults. Change them with [`TRIAGE_NEW_HOURS` and `TRIAGE_QUIET_HOURS`](/configuration#server).

```bash
triage resolve <issue>...
triage mute <issue>...
triage reopen <issue>...
triage note <issue> <text>
```

An event later than an issue's resolution reopens it as regressed, and decision models look at it again. A quiet issue that happens again goes back to ongoing; nothing is resolved for you. Add `--server <url>`, or set `TRIAGE_SERVER`, to change a remote server's issues as the admin in `TRIAGE_ADMIN_TOKEN`.

## Notes

Say why with `--note` (or `-m`) when you resolve, mute or reopen an issue, such as what fixed it, the version with the fix and the hosts it's on. `triage note` adds a note without changing the status. Notes take Markdown and are redacted like events before they're stored or sent.

```bash
triage resolve <issue> --note "Fixed in 1.4.2, updated on every host"
```

Each issue keeps its notes with every status change, who made it and when, and when it regressed and on which host. When a resolved issue comes back, they show whether that host has the fix or whether it's a different case. The issue page, `get_issue` and `find_similar_issues` all show them, newest first.

## Merging

Grouping can't catch everything: the same crash with different top frames, or the same error worded a little differently, ends up as two issues. Merge them into one:

```bash
triage merge <issue> <issue>...
triage unmerge <issue>                  # list its fingerprints
triage unmerge <issue> <fingerprint>    # move one back out
```

The issue seen first is kept, then the one with more events, then the lower ID. It takes the kind and title of the cause, so a crash wins over the unit failure it caused. It's muted if any of the issues was, open if any was and resolved otherwise, and keeps the latest decision, suggestion and label. The others' IDs and links lead to it, and new events for any of them join it.

Each issue it took in shows as a fingerprint, the key that groups an issue's events. Unmerging one moves its events back out into an issue of their own, with the same status but no decisions, label or suggestions, so they're decided on afresh. Both issues get a note saying what happened.

## In a browser

The server has a web page at its own URL, such as `http://localhost:7171/`. It lists the server's issues with the hosts each happened on, loading more as you scroll. Search their titles, sort them by when they were last or first seen, how likely the latest decision says they're worth fixing, how many events they have or their title, and group them by state, kind or label. Groups collapse, and the page remembers which ones you collapsed.

**Filters** opens a panel with lists of states, hosts, kinds and labels, with how many issues each has. States start with regressed, new and ongoing ticked, so quiet, resolved and muted issues stay out of the way; everything else starts ticked. Untick what you don't want to see, and each list's clear button goes back to how it started. The page remembers these choices in the browser.

Tick issues, or a whole group, to resolve, mute, reopen or label them together, or tick two or more to [merge](#merging) them. To go through issues that have stopped happening, tick only **Quiet** in Filters and resolve or mute the ones you're done with. Each issue's page shows how often it happened on each host, its 20 latest events with where each came from, what each decision model made of it and which worker asked, any suggested fixes, the warnings its program logged most often on those hosts, its notes, and buttons to resolve, mute, reopen or unmute it with an optional note, or to add a note on its own. A merged issue's page lists its fingerprints, each with an **Unmerge** button.

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

asks a language model how to fix issues, and stores its answers. It sends the same trimmed, redacted description decision models get, plus the unit, the lines it logged before it failed and the 5 warnings its program logged most often, and caps each response at 4,096 tokens, thinking included. Each suggestion records the events it was based on.
