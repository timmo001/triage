---
title: Issues
description: How events become issues, the states an issue goes through, and how decision models are measured.
---

Triage groups events into issues by what went wrong, not when or where:

- Crashes group by executable and signal, plus their top stack frames when there are any.
- Failed units group by unit and how they failed. Transient scopes, `systemd-run` units, session scopes and units with numbered instances each group as one.
- Out-of-memory kills group by the process that was killed.
- Errors group by the program that logged them and the message, with its numbers, paths, IDs and addresses taken out.

The same fault on two hosts is one issue, with events from both.

```bash
triage issues            # this host's issues
triage issues --server   # the server's, on the server
```

## States

| State | Means |
| --- | --- |
| New | First seen in the last week |
| Ongoing | Seen before that, and still open |
| Regressed | Happened again after it was resolved, in the last week |
| Resolved | Fixed, as far as you know |
| Muted | Hidden from decision and language models, however often it happens |

```bash
triage resolve <issue>...
triage mute <issue>...
triage reopen <issue>...
```

An event later than an issue's resolution reopens it as regressed, and decision models look at it again. Add `--server <url>` to change a remote server's issues as the admin in `TRIAGE_ADMIN_TOKEN`.

## Decisions

A decision model answers three questions about each new or regressed issue: whether it's worth fixing, how severe it is and what likely caused it, each with probabilities. The answers are only stored for now, to compare models before they drive anything.

```bash
triage decide            # decide on the server's new issues now
```

## Labels and agreement

Label issues by hand to measure decision models against your own judgement:

```bash
triage label <issue> worth
triage label <issue> noise
triage agreement
```

`agreement` shows, for each model, how many labelled issues it was sure about (worth at least 0.8 or at most 0.2), and how often it was right when it was.

## Suggestions

```bash
triage suggest <issue>...
```

asks a language model how to fix issues, and stores its answers. It sends the same trimmed, redacted description decision models get, plus the unit and the lines it logged before it failed, and caps each response at 4,096 tokens, thinking included. Each suggestion records the events it was based on.
