# Triage

Capture crashes and errors from your machines, decide which are worth fixing, and suggest fixes.

## Self-hosting

The server speaks plain HTTP. For HTTPS, run it behind a reverse proxy such as Caddy, Traefik or nginx, or behind Cloudflare, and let that handle TLS.

```sh
docker compose up -d
docker compose exec triage triage hosts add desktop
```

For HTTPS through Caddy, with certificates for your domain set up automatically:

```sh
TRIAGE_DOMAIN=triage.example.com docker compose -f compose.yaml -f compose.caddy.yaml up -d
```

Or through a Cloudflare Tunnel, which needs no open ports at all. Create a tunnel in the Cloudflare dashboard, add a public hostname pointing at `http://triage:7171`, and use its token:

```sh
TUNNEL_TOKEN=eyJ... docker compose -f compose.yaml -f compose.cloudflared.yaml up -d
```

The server always listens on `7171` inside the container, so proxies and tunnels can rely on it. Change the published port with `TRIAGE_PORT`.

`hosts add` prints the host's token once. On that host, set `TRIAGE_SERVER` to the server's URL and `TRIAGE_TOKEN` to the token, then run `triage collect --follow --upload`.

Host tokens can only send events. To read issues from the API, add an admin with `triage admins add <name>` and use its token. `hosts list` and `admins list` show who has a token, and `hosts remove` and `admins remove` revoke one.

| Variable | Default | |
| --- | --- | --- |
| `TRIAGE_HOSTNAME` | `127.0.0.1` (`0.0.0.0` in the container) | Address to listen on |
| `TRIAGE_PORT` | `7171` | Port to listen on |
| `TRIAGE_SERVER_DB` | `$XDG_STATE_HOME/triage/server.db` (`/data/server.db` in the container) | Server database |
| `TRIAGE_TRUST_PROXY` | `false` | Trust `X-Forwarded-Host` and `X-Forwarded-For`. Only turn this on when the proxy is the only way to reach the server |
| `TRIAGE_DECIDE` | `false` | Ask a decision model about new issues every 5 minutes. The answers are only stored for now, to compare models |
| `TRIAGE_DECISION_PROVIDER` | `typesafe` | `typesafe` for any TypeSafe System One API, such as Ollaya or Ollama 0.35+ locally, or `cloudflare` for Clef on Workers AI with `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` |
| `TRIAGE_DECISION_URL` | `http://127.0.0.1:11435/v1` (Ollaya) | The System One API, such as `http://127.0.0.1:11434/v1` for Ollama |
| `TRIAGE_DECISION_API_KEY` | none | Key for a hosted System One API, such as TypeSafe or OpenCode Zen |
| `TRIAGE_DECISION_MODEL` | `laya` through System One, `clef-flash` with Cloudflare | Decision model, such as `laya` or `winnow` on Ollaya, or `nimble` on Ollama |

Decision models only see what's stored, which is redacted when it's captured. `triage label <issue> worth|noise` labels issues by hand, and `triage agreement` shows how often each model is sure and right against those labels.
