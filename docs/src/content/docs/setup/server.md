---
title: Run a server
description: Run the triage server as a user service, a container or a Home Assistant app.
---

The server stores events from your hosts, groups them into issues and keeps the daily AI limits. Run one, somewhere every host can reach.

It speaks plain HTTP on port 7171. For HTTPS, put it behind a reverse proxy such as Caddy, Traefik or nginx, or behind Cloudflare, and let that handle TLS.

## Choose where it runs

The server itself is light, and runs on a Home Assistant Green. The models that decide on issues and suggest fixes need much more, and can run on another machine as a [worker](/setup/workers). See [Plan your hardware](/hardware) for what each part needs and the setups that work best.

## User service

With the [Arch package](/install#arch-linux) installed, set any [options](/configuration#server) in `~/.config/triage/server.env`, then:

```bash
systemctl --user enable --now triage-server.service
loginctl enable-linger "$USER" # keep it running while you're logged out
```

The database lives in `~/.local/state/triage/server.db`, so `triage hosts add` and the other token commands work on it directly, without `--server`.

## Container

```bash
docker compose up -d
docker compose exec triage triage hosts add desktop
```

For HTTPS through Caddy, with certificates for your domain set up automatically:

```bash
TRIAGE_DOMAIN=triage.example.com docker compose -f compose.yaml -f compose.caddy.yaml up -d
```

Or through a Cloudflare Tunnel, which needs no open ports at all. Create a tunnel in the Cloudflare dashboard, add a public hostname pointing at `http://triage:7171`, and use its token:

```bash
TUNNEL_TOKEN=eyJ... docker compose -f compose.yaml -f compose.cloudflared.yaml up -d
```

The server always listens on `7171` inside the container, so proxies and tunnels can rely on it. Change the published port with `TRIAGE_PORT`. The database is in the `/data` volume.

## Home Assistant

Install the [Home Assistant app](/install#home-assistant), then:

1. Set **server_admin_token** to a long random value, at least 32 characters, such as from `openssl rand -base64 32`, and start the app.
2. Add hosts and workers from any machine with `triage` installed, using `--server`, as below.

The app's other options are **trust_proxy**, **decide_daily** and **suggest_daily**, which match the [settings](/configuration#server) of the same name. Small Home Assistant boards, such as the Green or Yellow, are rarely up to running models, so leave decide and suggest to a [worker](/setup/workers) on those.

**Triage** in Home Assistant's sidebar opens the [issues page](/issues#in-a-browser) for Home Assistant's admins, with no admin token needed: Home Assistant has already signed them in. It's served on a separate port that only answers Home Assistant, so port 7171 still needs a token.

The app stops briefly during backups so its database is copied consistently. Hosts keep their events until the server is back.

## Manage tokens remotely

When you don't have a shell on the server, as with the Home Assistant app, manage tokens over the API. Set `TRIAGE_SERVER_ADMIN_TOKEN` on the server to a long random value, at least 32 characters, then from any machine:

```bash
export TRIAGE_ADMIN_TOKEN=<the same value>
triage hosts add laptop --server https://triage.example.com
triage workers add desktop --server https://triage.example.com
```

`add`, `list` and `remove` on `hosts`, `workers` and `admins` all take `--server`. `TRIAGE_SERVER_ADMIN_TOKEN` isn't stored or listed; you can leave it empty once you've added an admin of your own with `triage admins add`.

## Tokens

| Token | Added with | Can |
| --- | --- | --- |
| Host | `triage hosts add <name>` | Send events |
| Worker | `triage workers add <name>` | Fetch work and send back decisions and suggestions |
| Admin | `triage admins add <name>` | Read issues, change their state and manage tokens |

Each token is printed once, when it's added, and refused by the others' endpoints. The server only stores a hash of it. `list` shows who has a token, and `remove` revokes one.
