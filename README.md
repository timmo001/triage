# Triage

Capture crashes and errors from your machines, decide which are worth fixing, and suggest fixes.

## Self-hosting

The server speaks plain HTTP. For HTTPS, run it behind a reverse proxy such as Caddy, Traefik or nginx, or behind Cloudflare, and let that handle TLS.

```sh
docker build -t triage .
docker run -d --name triage -p 7171:7171 -v triage:/data triage
docker exec triage triage hosts add desktop
```

`hosts add` prints the host's token once. On that host, set `TRIAGE_SERVER` to the server's URL and `TRIAGE_TOKEN` to the token, then run `triage collect --follow --upload`.

| Variable | Default | |
| --- | --- | --- |
| `TRIAGE_HOSTNAME` | `127.0.0.1` (`0.0.0.0` in the container) | Address to listen on |
| `TRIAGE_PORT` | `7171` | Port to listen on |
| `TRIAGE_SERVER_DB` | `$XDG_STATE_HOME/triage/server.db` (`/data/server.db` in the container) | Server database |
| `TRIAGE_TRUST_PROXY` | `false` | Trust `X-Forwarded-Host` and `X-Forwarded-For`. Only turn this on when the proxy is the only way to reach the server |
