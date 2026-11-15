Issues that always happen together now merge by themselves: a unit failure joins the crash or OOM kill behind it, and a multi-line log dump becomes one issue instead of one per line.

## Merging by rule

- **Unit failure it caused**: a `core-dump` unit failure joins the crash behind it, and an `oom-kill` one the OOM kill, when they're for the same unit on the same host within 10 seconds, whichever arrives first. This works event by event, so a unit that fails after two different crashes doesn't chain them together.
- **systemd error about the unit**: systemd's own errors about that unit within 10 seconds follow the unit failure.
- **Same log burst**: log errors from the same program on the same host, each within 2 seconds of the one before, such as a firmware error dump with one line per register, join the issue of the burst's first line. Kernel errors are also grouped by the message's first word, so different drivers don't merge. Only new fingerprints join a burst; one that already has an issue stays where it is.
- **Unmerge**: unmerging a fingerprint a rule joined sends its events back to their own issue, and the rule doesn't join them to it again.

See [Merging by rule](https://triage.timmo.dev/issues#merging-by-rule).

## Server

- When the database is updated to this version, migration `0023_rules` applies the unit failure and systemd rules to stored events, and merges stored issues whose every event falls in the bursts another issue's first line opens. Each issue kept gets a "Merged ... by rule" note. On one machine's 12,440 events this took 436 issues down to 263.

## Web UI

- A merged issue's fingerprints show which rule joined each one, if one did.

## CLI and MCP

- `triage unmerge <issue>` lists the rule beside each fingerprint, and the `merge_issues` description says which issues already come together by rule.

## Libraries

- `@timmo001/effect-triage` adds `Api.JoinRule` and a `rule` field on `Api.IssueFingerprint`.

**Full Changelog**: https://github.com/timmo001/triage/compare/0.24.1...0.25.0

