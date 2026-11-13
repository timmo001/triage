The Home Assistant app's page can take the whole screen, as the OpenCode app's does.

## Home Assistant

- **hide_sidebar**: a new option, on by default, hides Home Assistant's sidebar and header around the web UI. The menu button at the start of the header opens the sidebar over the page when you need it. On a phone, Home Assistant keeps its own header and menu. Turn it off to keep the sidebar.

## Server

- **`--hide-sidebar`** (`TRIAGE_HIDE_SIDEBAR`) does the same for the ingress port outside the app. See [Configuration](https://triage.timmo.dev/configuration#server).

## Dependencies

- Groundwork 0.27.0 for the web UI, Effect 4.1.4, the latest `caddy:2` image, and development dependency updates.

**Full Changelog**: https://github.com/timmo001/triage/compare/0.22.0...0.23.0

