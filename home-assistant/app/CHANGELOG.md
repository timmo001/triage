## Privacy

- IPv6 addresses followed by a colon, as in Home Assistant's `from <address>: Unexpected error`, are redacted. They weren't before.
- Account and list IDs, such as a calendar's or a task list's, are redacted as `<id>`: 16 or more letters and digits mixing upper and lower case and digits. See [Privacy](https://triage.timmo.dev/privacy).
- Redaction happens when an event is captured, so events stored before this keep them. Update hosts and the Home Assistant app to pick it up.

