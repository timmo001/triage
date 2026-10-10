# Triage

Runs the triage server, which collects crashes and errors from your machines and groups them into issues. The models that decide which issues are worth fixing, and suggest fixes, run on another machine as a worker, so nothing heavy runs on Home Assistant.

The full documentation is at [triage.timmo.dev](https://triage.timmo.dev), including [this app](https://triage.timmo.dev/setup/server#home-assistant), [installing triage](https://triage.timmo.dev/install) on your other machines and [every setting](https://triage.timmo.dev/configuration).

## Setting up

1. Set **server_admin_token** to a long random value, at least 32 characters, such as from `openssl rand -base64 32`, and start the app.
2. From a machine with [`triage` installed](https://triage.timmo.dev/install), add each machine to collect from, and a worker for the machine with the models:

   ```sh
   export TRIAGE_ADMIN_TOKEN=<the same value>
   triage hosts add laptop --server http://homeassistant.local:7171
   triage workers add desktop --server http://homeassistant.local:7171
   ```

3. Put the server's URL and each printed token in `~/.config/triage/agent.env` or `worker.env` on that machine, as the docs for [hosts](https://triage.timmo.dev/setup/hosts) and [workers](https://triage.timmo.dev/setup/workers) describe.

Open **Triage** in the sidebar to browse issues and resolve or mute them. It's for Home Assistant's admins, and needs no admin token.

The server speaks plain HTTP on port 7171, so tokens are only as private as your network. To reach it from outside, put it behind a reverse proxy or a Cloudflare tunnel for HTTPS, and turn on **trust_proxy** only if that's the only way in.

## Assist

The app announces its [MCP server](https://triage.timmo.dev/agents) to Home Assistant, which offers to add it under **Settings > Devices & services**. Add it, then turn on its tools for your conversation agent, and Assist can read issues and their events, and resolve, mute or label them.

## Options

These match the server's [settings](https://triage.timmo.dev/configuration#server) of the same name.

- **server_admin_token**: an admin token the server always accepts, for managing hosts, workers and admins with `--server`. It isn't stored or listed. Leave it empty once you've added an admin of your own with `triage admins add`.
- **trust_proxy**: trust `X-Forwarded-Host` and `X-Forwarded-For` from a reverse proxy.
- **decide_daily**: the most issues each decision model may decide on in any 24 hours, across all workers.
- **suggest_daily**: the most fixes each language model may suggest in any 24 hours, across all workers.
- **new_hours**: how long an issue stays new after it's first seen.
- **quiet_hours**: how long an issue goes without events before it's quiet, and how long it stays regressed.
- **language**: the web UI's language, English unless you pick another. See [Languages](https://triage.timmo.dev/languages).
- **collect_core**: collect Home Assistant Core's own errors and warnings, with their tracebacks, as the host `home-assistant`. On unless you turn it off. They're read from the host journal, which the app can read but not change, and redacted like every other host's events. The app also reads Home Assistant's config directory, read only, for the names of devices, entities, areas, floors, people and your home, which it redacts from Core's messages, and for the versions of Core and custom integrations. It only reads the registries in `.storage`, `.HA_VERSION` and custom integrations' manifests, never `secrets.yaml` or anything else.
- **collect_supervisor**: collect the Supervisor's own errors and warnings, such as an app that failed to start or an update that failed, the same way and as the same host. On unless you turn it off.

The database is kept in the app's data, and the app stops briefly during backups so it's copied consistently. Machines keep their events until the server is back.
