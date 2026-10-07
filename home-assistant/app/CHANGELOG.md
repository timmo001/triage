## Languages

- The web UI comes in English, German, Spanish, French, Italian, Japanese, Dutch, Polish, Brazilian Portuguese and Simplified Chinese. It's English unless an admin picks another with `TRIAGE_LANGUAGE`, `triage serve --language` or the Home Assistant app's **language** option. See [Languages](https://triage.timmo.dev/languages/).
- The translations are AI-generated, so some may read oddly. Corrections and new languages are very welcome.
- The Home Assistant app's options have names and descriptions, in the same languages.

## Issues

- Issues count as new for 24 hours instead of 72, and go quiet after 72 hours without events instead of a week. A resolved issue that comes back stays regressed for 72 hours too.
- Admins can change both with `TRIAGE_NEW_HOURS` and `TRIAGE_QUIET_HOURS`, or the app's **new_hours** and **quiet_hours** options.

## Libraries

- `@timmo001/effect-triage` adds the `Translations`, `Message` and `PluralForm` schemas, and a `GET /api/translations` endpoint to the `system` group.
- `newMillis` and `recentMillis` are now 24 and 72 hours, and are the defaults rather than fixed values.

