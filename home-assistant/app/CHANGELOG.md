## Home Assistant

- Core's errors show the integration that logged them, such as `iss`, with links to its docs and Core's issues for one built into Core. Custom integrations are marked as custom.
- Each of Core's errors keeps the warnings and errors Core logged in the 30 seconds before it, from any integration, under **What it logged before**.
- Core's events have their own source, `homeassistant-core`, rather than `journal`. Events collected before keep `journal`.
- Suggestions for Core's errors point to fixes in Home Assistant rather than `systemctl` and `journalctl`, and when an error doesn't say what went wrong, such as "Unable to retrieve data after 5 consecutive update failures", they say to turn on debug logging for the integration.

## Issues

- An issue's page lists the other issues that happened on the same host within a minute of its latest events, under **Around the same time**. Several failing together often share a cause, such as a network or device going down.

## Agents

- `get_issue` returns `nearby`, the issues that happened around the same time.

## Libraries

- `@timmo001/effect-triage` adds the `Integration` schema and an optional `integration` on events.
- It adds the `NearbyIssue` schema, `nearbyMillis` and `maxNearby`, and `IssueReview` has `nearby`, which defaults to empty for older servers.

