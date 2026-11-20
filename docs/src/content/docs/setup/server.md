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

The database lives in `~/.local/state/triage/server.db`, so `triage hosts add` and the other token and issue commands work on it directly, without `--server`, as long as `TRIAGE_SERVER` isn't set.

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

The app's other options are **trust_proxy**, **decide_daily**, **suggest_daily**, **new_hours**, **quiet_hours**, **language** and **hide_sidebar**, which match the [settings](/configuration#server) of the same name. Small Home Assistant boards, such as the Green or Yellow, are rarely up to running models, so leave decide and suggest to a [worker](/setup/workers) on those.

The app also collects Home Assistant Core's own errors and warnings, as the host `home-assistant`, unless you turn off **collect_core**. The app reads them from the host journal, which Home Assistant mounts into it read only. Each error comes with its traceback, and is grouped by the logger that logged it. Its integration is shown with it, with links to the integration's docs and Core's issues for one built into Core, or its version and issue tracker for a custom one, along with Core's version and any warnings and errors Core logged in the 30 seconds before it. They're redacted like every other host's events, and the names of devices, entities, areas and people in Home Assistant are taken out too. The app reads those, and the versions, from Home Assistant's config directory, which is also mounted read only. If the app can't read the host journal, the issues page says so.

The Supervisor's errors and warnings, such as an app that failed to start or an update that failed, are collected the same way and as the same host, unless you turn off **collect_supervisor**. The Supervisor logs in the same format as Core, so its errors are grouped by logger and come with their tracebacks too.

Your other apps' errors and warnings are collected as well, unless you turn off **collect_apps**. Apps log in all sorts of formats, so the app reads lines that give a level near their start, such as `[12:00:00] ERROR: …`, `2026-10-10 12:00:00 WRN …`, `[W] …` or `[error] …`, and groups them by app. Apps that log in Core's format keep their tracebacks. Lines with no level can't be told apart from an app's normal output, so they're left out, and so is triage's own log. New apps are picked up within the hour.

The host's own journal, its kernel, systemd and services, is collected too, unless you turn off **collect_host**: crashes, failed units, out-of-memory kills and errors, as the agent collects them on a Linux host. Docker puts every container's output in the same journal, so that's left out here, as it's collected as Core's, the Supervisor's, its plugins' and apps' logs instead.

The Supervisor plugins, its own containers for DNS, audio and so on, are read the same way if you turn on **collect_plugins**. It's off by default, since DNS logs a lot that's rarely worth fixing, such as lookups that time out.

**Triage** in Home Assistant's sidebar opens the [issues page](/issues#in-a-browser) for Home Assistant's admins, with no admin token needed: Home Assistant has already signed them in. It's served on a separate port that only answers Home Assistant, so port 7171 still needs a token.

Home Assistant's backups of the app stop it briefly so its database is copied consistently. Hosts keep their events until the server is back. The app's own [backups](#backups) are left out of them, since they're copies of the database already. To move the server off Home Assistant, download a backup and restore it on the new server.

## Backups

The server backs up its database while it runs, into a `backups` folder beside it: `~/.local/state/triage/backups` for the user service, or `/data/backups` in the container and the Home Assistant app. A backup is a copy of the database, with every issue, event, host and token in it. It also holds the values behind the redaction tokens the server captured on its own machine, such as Home Assistant's, so keep it as private as the server itself; the server keeps its backups readable only by itself. The server's settings, such as its environment or the app's options, aren't in it, so set those again on a new server.

Make, download and restore them from **Backups** in the web UI's header, or with [`triage backups`](/commands/backups):

```bash
triage backups create
triage backups list
triage backups download triage-2026-11-20T20-21-56.triage-backup
```

Copy the backups somewhere else too, so they outlast the machine. The web UI downloads one through a link that works once, for 5 minutes.

A restore checks the backup first: it has to be a sound triage database, and not from a newer triage than the server, which would have to be updated first. The server then starts again on it, in its own process, keeping the database it replaced beside it as `server.db.before-restore`. Restore one the server keeps:

```bash
triage backups restore triage-2026-11-20T20-21-56.triage-backup
```

Or upload one from this machine, such as a backup from another server, which the server keeps with the others:

```bash
triage backups upload triage-2026-11-20T20-21-56.triage-backup
```

Only one backup or restore runs at a time. Like the token commands, `triage backups` works on this machine's database without `--server`, as long as `TRIAGE_SERVER` isn't set. There, a restore is checked and staged beside the database, and put in place when the server next starts, so restart it.

### Move a server

1. On the old server, make a backup and download it.
2. Set up the new server with the same [settings](/configuration#server), and start it.
3. Upload the backup to it with `triage backups upload <file> --server <new server>`, or **Restore from a file** in its web UI. Without an admin token on the new server yet, run `triage backups upload <file>` on it without `--server`, then restart it.
4. Point the hosts' and workers' `TRIAGE_SERVER` at the new server. Their tokens came with the backup, so they keep working.

## Manage tokens remotely

When you don't have a shell on the server, as with the Home Assistant app, manage tokens over the API. Set `TRIAGE_SERVER_ADMIN_TOKEN` on the server to a long random value, at least 32 characters, then from any machine:

```bash
export TRIAGE_ADMIN_TOKEN=<the same value>
triage hosts add laptop --server https://triage.example.com
triage workers add desktop --server https://triage.example.com
```

`add`, `list` and `remove` on `hosts`, `workers` and `admins` all take `--server`, or use `TRIAGE_SERVER` when it's left out, so `export TRIAGE_SERVER=https://triage.example.com` saves typing it each time. `TRIAGE_SERVER_ADMIN_TOKEN` isn't stored or listed; you can leave it empty once you've added an admin of your own with `triage admins add`.

## Tokens

| Token | Added with | Can |
| --- | --- | --- |
| Host | `triage hosts add <name>` | Send events |
| Worker | `triage workers add <name>` | Fetch work and send back decisions and suggestions |
| Admin | `triage admins add <name>` | Read issues, change their state and manage tokens |

Each token is printed once, when it's added, and refused by the others' endpoints. The server only stores a hash of it. `list` shows who has a token, and `remove` revokes one.
