## Merging

- Issues that are the same problem can be merged into one: the same crash with different top frames, or the same error worded a little differently. See [Merging](https://triage.timmo.dev/issues/#merging).
- The issue seen first is kept, then the one with more events, then the lower ID. It takes the kind and title of the cause, so a crash wins over the unit failure it caused, and it's muted if any of the issues was, open if any was and resolved otherwise.
- The merged issues' IDs and links lead to the one kept, and new events for any of them join it.
- Unmerging moves a fingerprint's events back out into an issue of their own, which models decide on afresh. Both issues get a note saying what happened.
- An upgrade fills in each event's fingerprint. Crashes whose frames had a module of `n/a` no longer start a duplicate issue when they happen again.

## Web UI

- Tick two or more issues in the list to **Merge** them.
- A merged issue's page lists its fingerprints, each with an **Unmerge** button, and an old issue link switches to the issue it was merged into.

## CLI

- `triage merge <issue> <issue>...` merges issues.
- `triage unmerge <issue>` lists an issue's fingerprints, and `triage unmerge <issue> <fingerprint>` moves one back out.

## Agents

- The new `merge_issues` tool merges issues. Agents are told to ask you first, and it's marked destructive, so clients that check for that ask you to approve it as well.
- `get_issue` returns the issue's fingerprints.

## Libraries

- `@timmo001/effect-triage` adds the `IssueFingerprint` and `Merged` schemas, the `NothingToMerge`, `FingerprintNotFound` and `NothingToUnmerge` errors, and `POST /api/issues/merge` and `POST /api/issues/:id/unmerge` endpoints, `merge` and `unmerge`, to the `issues` group.
- `IssueReview` has `fingerprints`, which default to empty for older servers.

