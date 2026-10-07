## Issues

- Errors and OOM kills group across hosts, like crashes and unit failures already did. The same error on two machines is now one issue, showing both hosts. Existing per-host issues merge when the server updates.
- Crash frames group by module file name rather than full path, so `/opt/google/chrome/chrome` and `chrome` match. Existing crash issues split this way merge too.
- When issues merge, the result is muted if any was muted, otherwise open if any was open. It keeps the latest label, and the latest decision and suggestion from each model.
- Issues count as new for 72 hours instead of a week.
- Similar issues for an error are other errors from the same program, and for an OOM kill, other OOM kills.

## Libraries

- `onHost` is removed from `@timmo001/effect-triage`, as no fingerprint includes the host any more.

