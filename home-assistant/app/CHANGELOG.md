## Privacy

- IPv4 addresses written with dashes in a host name, as in Plex's `a-b-c-d.<id>.plex.direct` or a cloud host's `ip-a-b-c-d.internal`, are redacted as `<ip>` tokens like any other address. They weren't before. A migration replaces the ones already stored with a plain `<ip>`, and their issues keep their next events. See [Privacy](https://triage.timmo.dev/privacy).

## Home Assistant

- The Arch package for 0.18.1 wasn't published, after GitHub refused a download mid-build. This release has one, and re-running a failed Arch build now works.
