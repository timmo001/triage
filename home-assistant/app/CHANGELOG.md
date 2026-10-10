## Home Assistant

The app now collects much more than Core's errors, all as the host `home-assistant`, with the same redaction, Home Assistant's names included:

- **The Supervisor's errors**, read like Core's, with their tracebacks. On by default with `collect_supervisor`.
- **Apps' errors.** Apps log in all sorts of formats, so only lines that give a level near their start are read, such as `ERROR:`, `[W]`, `WRN` or `[warning]`. Apps that log in Core's format keep their tracebacks. Each event is named by its app, and triage's own log is left out. New apps are picked up within the hour. On by default with `collect_apps`.
- **The host's own journal**: crashes, failed units, out-of-memory kills and errors from the kernel, systemd and the host's services. Docker puts every container's output in the same journal, so that's left out here, and nothing is collected twice. On by default with `collect_host`.
- **The Supervisor plugins' errors**, such as DNS and audio, read the same way as apps. Off by default with `collect_plugins`, since DNS logs a lot of lookups that time out.

The issues page now says Home Assistant's errors aren't being collected, rather than only Core's, when the app can't read the host journal. See [Setting up the server](https://triage.timmo.dev/setup/server#home-assistant).

## Grouping

- URLs are templated as `<url>`, so the same failure against several endpoints is one issue.
- Numbers with a unit, such as `30s`, `250ms` or `512kB`, are templated with the unit kept, so a back-off's growing delays and every OOM kill's memory sizes don't each start an issue.
- Crash frames no longer keep `n/a` as their module, which grouped them as `a`. A migration fixes stored crashes, and their issues keep their events.

Issues whose messages have URLs or numbers with units get a new fingerprint, so each one starts a new issue once, on its next event. Resolve or mute the old ones as they go quiet.

## Privacy

- The user name and password in a URL are redacted, as in `https://<redacted>@example.com`.
- Unit names with an `@` are no longer mistaken for email addresses when their instance has a colon in it, as socket-activated ones do, such as `sshd@3-<ip>:22-<ip>:51234.service`, or when they're a drop-in directory.

## API

- **Breaking:** `GET /api/hosts/collection` returns `homeAssistant` instead of `homeAssistantCore`, and `Api.CoreCollection` is now `Api.HomeAssistantCollection`, since it covers more than Core.

