## Notes

- Issues keep notes. Say why you resolved, muted or reopened one, such as what fixed it, the version with the fix and the hosts it's on, so when it comes back on another host you can tell whether that host has the fix or it's a different case. See [Notes](https://triage.timmo.dev/issues/#notes).
- Every status change is kept with who made it and when, and so is each regression, with the host it came back on. Earlier resolutions and regressions are copied over, without a note.
- Notes take Markdown and are redacted like events before they're stored or sent.

## Web UI

- The issue page has a note box: Resolve, Mute and Reopen save its note with the change, and **Add note** saves one on its own.
- A **Notes** section lists the issue's notes and status changes, newest first.

## CLI

- `triage resolve`, `mute` and `reopen` take `--note` (or `-m`).
- `triage note <issue> <text>` adds a note without changing the status.

## Agents

- `set_issue_status` takes an optional `note`, and the new `add_issue_note` tool adds one on its own.
- `get_issue` and `find_similar_issues` return each issue's notes, and agents are told to resolve with a note on what fixed it and to check the notes when an issue regresses.

## Libraries

- `@timmo001/effect-triage` adds the `IssueNote`, `NoteStatus` and `NoteText` schemas and `maxNote`, a `note` on the `setStatus` payload, and a `POST /api/issues/:id/notes` endpoint, `addNote`, to the `issues` group.
- `IssueReview` and `SimilarIssue` have `notes`, which default to empty for older servers.

