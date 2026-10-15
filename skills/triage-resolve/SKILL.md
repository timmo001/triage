---
name: triage-resolve
description: Find and close the triage issues a fix settles, with a note on what fixed it and where. Use after fixing a failing systemd unit, a crash or core dump, an out-of-memory kill, or an error logged to the journal or Home Assistant's logs on a machine triage collects from, whether or not the work started from a triage issue, before reporting the fix done. Not for fixes that involve none of those failures.
license: Apache-2.0
compatibility: Needs triage's MCP server (triage mcp, or a triage server's /mcp with an admin token). The triage CLI can resolve, mute and note issues by ID without it.
---

# Resolve triage issues after a fix

triage collects failures from the journal and Home Assistant's logs on every enrolled host and groups them into issues. When you fix one of those failures somewhere else, such as in a dotfiles or service repository, its issue stays open until someone resolves it. A bare "Fixed" tells nobody which change fixed it or whether it reached the host when it comes back.

## When

- After the fix is in place and verified, before you report it done.
- If the fix isn't committed or deployed yet, add a note with `add_issue_note` saying what's in progress, and resolve once it's in place.

## Find the issues

`list_issues` matches `search` against part of the title, ignoring case, and returns every state when `state` is left out, so a resolved issue that came back shows up too. Set `host` to the hosts involved.

Titles take these shapes, so search on the name, not the message:

| Kind | Title | Search for |
| --- | --- | --- |
| `UnitFailure` | `<unit> failed (<result>)` | The unit's name without its instance or suffix: `dot-notifications-dismiss`, not `dot-notifications-dismiss@1000.service` |
| `Crash` | `<executable> crashed with <signal>` | The executable's file name |
| `OutOfMemory` | `<process or unit> was killed for memory` | The process name |
| `LogError` | `<program>: <first line>` | The program's journal identifier, which is usually the script or binary, not its unit. For Home Assistant, the logger, such as `components.hue` |

- Numbered instances show as `@<n>`, transient scopes as `-<id>`, and redacted user names, host names, paths and addresses as tokens, so search only the parts that don't change.
- Merged issues keep the crash's title, so when a unit failed because its program crashed, search for the program too.
- For failures that started while you built and tested the fix, such as a half-finished unit, also list the hosts' issues sorted by `lastSeen` and look for ones first seen during the work.
- `get_issue`'s `nearby` lists other issues on the same hosts within a minute, which finds a unit's log errors under its program's name.

## Confirm each match

Read it with `get_issue` before deciding it's the one you fixed:

- Its events show the failure you fixed, not another one with a similar name.
- Its `lastSeen` is before the fix took effect. Events after that mean it isn't fixed there.
- Its notes don't describe an earlier fix that was different. If it was resolved before, say why it came back.

## Check every host

Each host in `get_issue`'s `hosts` needs the fix. Check the ones you can reach: the commit is pulled or deployed (`dot update` run, for example), the package is at the fixed version (`pacman -Q <package>`), and the unit or program now runs cleanly. Ask the user about the hosts you can't reach.

## Ask, then resolve

Ask the user once, listing each issue with its title, the status you propose and the note. Then call `set_issue_status` for each.

The note says what fixed it and where, so if it comes back anyone can check whether the fix reached that host:

```markdown
Fixed in timmo001/dotfiles a1b2c3d: the unit waited for the notification daemon before dismissing. In place on desktop and laptop.
```

Use the commit, or the package and version when it ships as a package, and the hosts it's in place on.

- If a unit failure and a crash are the same problem, ask before merging them with `merge_issues`.
- Failures caused by building or testing the fix are resolved with it, with a note saying so, so they reopen as regressed if they happen again.
- Mute only noise that will keep happening and can't be fixed, with a note on why. Label issues with `label_issue` when it's clear whether they're worth fixing or noise.

## Without the MCP server

Say the triage tools aren't available and list the issues for the user to find. With issue IDs, the CLI does the rest against the server in `$TRIAGE_SERVER`: `triage resolve <id> --note "<note>"`, `triage mute <id> --note "<note>"` and `triage note <id> "<note>"`.
