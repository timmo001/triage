## Home Assistant

- The app collects Home Assistant Core's own errors and warnings, as the host `home-assistant`. It's on by default, and **collect_core** turns it off. See [Home Assistant](https://triage.timmo.dev/setup/server#home-assistant).
- Each error comes with its traceback and is grouped by the logger that logged it, such as `homeassistant.components.hue` or `custom_components.thing`. Warnings are counted under the same logger.
- The app reads them from the host journal, which Home Assistant now mounts into it read only, and redacts them like every other host's events. The host's own name is redacted too, apart from the default `homeassistant`.
- This is a first version, not yet tried widely on Home Assistant OS. Entity and device names in Core's messages aren't redacted or grouped yet.

## Warnings

- Hosts count warnings, apart from the kernel's, by program and message with the parts that change replaced, and keep each count for a week. They only send the counts for programs with an issue that isn't muted, and warnings never become issues of their own. See [Privacy](https://triage.timmo.dev/privacy).
- An issue's page shows the warnings its program logged most often on the hosts it happened on.
- Suggestions get the program's 5 most frequent warnings, and `get_issue` returns its warnings.

## Issues

- A log error's title is its first line, so a traceback after it stays out of the title.

## CLI

- `triage serve --collect-core` (`TRIAGE_COLLECT_CORE`) collects Core's errors when the server runs in the Home Assistant app.

## Libraries

- `@timmo001/effect-triage` adds the `Warning` schema, `Fingerprint.program`, the `IssueWarning` schema and `maxIssueWarnings`, and `POST /api/warnings` to the `ingest` group.
- `IssueDetail` has `warnings`, which default to empty for older servers.
- `Issue.title` only uses a log error's first line.

