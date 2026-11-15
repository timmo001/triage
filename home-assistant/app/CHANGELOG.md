The web UI can be installed as an app, starts offline, and moves itself onto a new version when the server is updated.

## Web UI

- **Install as an app**: behind HTTPS, or at `localhost`, the browser offers to install the web UI, with a banner and an Install button in the header. Not now hides the banner, and the header button stays for as long as the browser can install it. Once opened, the page also loads offline. See [Install](https://triage.timmo.dev/install#install-the-web-ui-as-an-app).
- **Updates**: after the server is updated, an open page reloads itself onto the new version. If that doesn't work, a banner offers a Reload button.

## Server

- API calls from a web UI page of another version get `426 Upgrade Required`, which tells the page to reload. Hosts, agents, the event streams and anything else that doesn't send the `x-triage-version` header aren't affected.
- Serves the web UI's service worker, manifest and icons. Files without a content hash in their name are rechecked by the browser instead of cached for a year.

## Libraries

- `@timmo001/effect-triage` adds `Version.header`, the header the web UI sends its version in.

## Dependencies

- Groundwork 0.45.0 for the web UI, with `@timmo001/groundwork-pwa` for the install and service worker, DOMPurify 3.4.18, and development dependency updates.

**Full Changelog**: https://github.com/timmo001/triage/compare/0.23.0...0.24.0

