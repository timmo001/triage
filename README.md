# Triage

Capture crashes and errors from your machines, decide which are worth fixing, and suggest fixes.

## Arch Linux

`triage-bin` (each release) and `triage-git` (`main`) are in the [timmo pacman repository](https://github.com/timmo001/arch-repo). Both install the `triage` command and three user services, none of them enabled.

On the machine that runs the server, set any of the options below in `~/.config/triage/server.env`, then:

```sh
systemctl --user enable --now triage-server.service
loginctl enable-linger "$USER" # keep it running while you're logged out
triage hosts add desktop
```

On each machine to collect from, put the server's URL and the token `hosts add` printed in `~/.config/triage/agent.env`:

```sh
TRIAGE_SERVER=https://triage.example.com
TRIAGE_TOKEN=...
```

then run `systemctl --user enable --now triage-agent.service`. The agent doesn't start until that file exists.

The models don't have to run on the server. On a machine that has them, add it as a worker with `triage workers add desktop` on the server, and put the server's URL, the printed token and the model settings below in `~/.config/triage/worker.env`:

```sh
TRIAGE_SERVER=https://triage.example.com
TRIAGE_WORKER_TOKEN=...
TRIAGE_DECIDE=true
TRIAGE_DECISION_MODEL=winnow
```

then run `systemctl --user enable --now triage-worker.service`. The worker fetches issues from the server and sends back its answers, so the models only need to be reachable from the worker. The server's daily limits apply to every worker together, and nothing queues up while a worker is off.

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

Hosts redact everything they collect before storing or sending it, including their own user and host names. Set `TRIAGE_REDACT_NAMES` on a host to other names to hide, comma-separated, such as your GitHub account, which shows up in repository URLs. For failures and crashes, hosts also keep the last 10 lines the unit logged, redacted the same way, to give suggestions something to go on.

Host tokens can only send events. To read issues from the API, add an admin with `triage admins add <name>` and use its token. Worker tokens, from `triage workers add <name>`, can only fetch work and send back answers. `hosts list`, `admins list` and `workers list` show who has a token, and `remove` on each revokes one.

Admins can also manage tokens over the API, so you don't need a shell on the server, such as with the Home Assistant app. Set `TRIAGE_SERVER_ADMIN_TOKEN` on the server to a long random value (at least 32 characters, such as from `openssl rand -base64 32`), then from any machine:

```sh
TRIAGE_ADMIN_TOKEN=<the same value> triage hosts add laptop --server https://triage.example.com
```

`add`, `list` and `remove` all take `--server`.

| Variable | Default | |
| --- | --- | --- |
| `TRIAGE_HOSTNAME` | `127.0.0.1` (`0.0.0.0` in the container) | Address to listen on |
| `TRIAGE_PORT` | `7171` | Port to listen on |
| `TRIAGE_SERVER_DB` | `$XDG_STATE_HOME/triage/server.db` (`/data/server.db` in the container) | Server database |
| `TRIAGE_TRUST_PROXY` | `false` | Trust `X-Forwarded-Host` and `X-Forwarded-For`. Only turn this on when the proxy is the only way to reach the server |
| `TRIAGE_SERVER_ADMIN_TOKEN` | none | An admin token the server always accepts, at least 32 characters, for managing tokens with `--server`. It isn't stored or listed |
| `TRIAGE_DECIDE` | `false` | Ask a decision model about new issues every 5 minutes. The answers are only stored for now, to compare models |
| `TRIAGE_DECIDE_DAILY` | `20` | The most issues each decision model may decide on in any 24 hours, by the server with `TRIAGE_DECIDE` and by its workers together |
| `TRIAGE_DECISION_PROVIDER` | `typesafe` | `typesafe` for any TypeSafe System One API, such as Ollaya or Ollama 0.35+ locally, or `cloudflare` for Clef on Workers AI with `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` |
| `TRIAGE_DECISION_URL` | `http://127.0.0.1:11435/v1` (Ollaya) | The System One API, such as `http://127.0.0.1:11434/v1` for Ollama |
| `TRIAGE_DECISION_API_KEY` | none | Key for a hosted System One API, such as TypeSafe or OpenCode Zen |
| `TRIAGE_DECISION_MODEL` | `laya` through System One, `clef-flash` with Cloudflare | Decision model, such as `laya` or `winnow` on Ollaya, or `nimble` on Ollama |
| `TRIAGE_LLM_PROVIDER` | `openai` | `openai` for any OpenAI-compatible API, `anthropic` for any Anthropic-compatible one, or `cloudflare` for Workers AI with `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` |
| `TRIAGE_LLM_URL` | OpenAI's or Anthropic's own | The API, such as `https://openrouter.ai/api/v1`, `https://opencode.ai/zen/v1` or `http://127.0.0.1:11434/v1` for Ollama |
| `TRIAGE_LLM_API_KEY` | none | Key for the API, when it needs one |
| `TRIAGE_LLM_MODEL` | none | Language model for fix suggestions, such as `@cf/google/gemma-4-26b-a4b-it` on Workers AI |
| `TRIAGE_SUGGEST` | `false` | Suggest fixes every 15 minutes for issues the decision model rates worth fixing with at least 0.8 probability. Needs `TRIAGE_LLM_MODEL` |
| `TRIAGE_SUGGEST_DAILY` | `5` | The most suggestions each language model may make in any 24 hours, by the server with `TRIAGE_SUGGEST` and by its workers together |

Any of these can also come from a JSON file at `TRIAGE_OPTIONS`, with lowercase keys and no `TRIAGE_` prefix, such as `{ "decide": true, "decide_daily": 10, "cloudflare_api_token": "..." }`. Environment variables win over the file. The Home Assistant app uses this for its options.

AI only runs when you ask for it. `TRIAGE_DECIDE` and `TRIAGE_SUGGEST` are off unless you turn them on, and each stops at its daily limit. On the `serve` and `work` command lines, the language model settings are `--llm-provider`, `--llm-url` and `--llm-model`, since `--provider`, `--url` and `--model` are the decision model's.

Decision models only see what's stored, which is redacted when it's captured. `triage label <issue> worth|noise` labels issues by hand, and `triage agreement` shows how often each model is sure and right against those labels.

`triage suggest <issue>...` asks a language model how to fix issues and stores its answers. It sends the same trimmed, redacted description decision models get, and caps each response at 4,096 tokens, thinking included.
