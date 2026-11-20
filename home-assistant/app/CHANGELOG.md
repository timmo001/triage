The Home Assistant app can now leave the server to another machine and only collect Home Assistant's errors, sending them there the way the agent does on a Linux host.

## Home Assistant app

- **server_url** and **host_token**: with a server's URL and a host token from it, the app runs no server of its own. It collects Home Assistant's errors as the **collect_** options say, keeps them in `/data/triage.db` and sends them every 30 seconds, holding on to them while the server can't be reached.
- Add the token on the server with `triage hosts add home-assistant`, so the errors keep the host `home-assistant` and land on the same issues as before.
- **server_internal**: also send the values behind redaction tokens, so the server's web UI can show them, only to a server on this network.
- In this mode port 7171 only answers the Supervisor's health check, **Triage** in the sidebar says where the errors go, with a link, and there's no MCP server to announce.
- Without **server_url** the app works as it did.

See [Collect only](https://triage.timmo.dev/setup/server#collect-only).

## CLI

- `triage serve --server-url <url> --host-token <token>`, or `TRIAGE_SERVER_URL` and `TRIAGE_HOST_TOKEN`, runs this mode, with `--server-internal` or `TRIAGE_SERVER_INTERNAL` for the values.

**Full Changelog**: https://github.com/timmo001/triage/compare/0.26.0...0.27.0
