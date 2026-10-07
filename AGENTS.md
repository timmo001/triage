# triage agents

`triage` captures crashes and errors from several machines, groups them into issues, decides with a decision model which are worth fixing, and suggests fixes with an LLM. It starts with Linux and Omarchy hosts; Home Assistant comes later.

## Stack

- Runtime, package manager and compiler: Bun.
- Language: TypeScript with Effect v4. Read `node_modules/effect/ai-docs` and the Effect source before writing Effect code.
- Prefer Effect platform services (`FileSystem`, `Path`, `ChildProcessSpawner`, `Socket`, `SocketServer`, `effect/cli`) from `@effect/platform-bun` over hand-written Node or Bun wrappers.
- Task runner: mise.

## Rules

- Keep source under `src/`. Keep the CLI tree in `src/index.ts` so help and completions come from one place.
- Published libraries live under `packages/`: `@timmo001/effect-triage` (shared schemas and protocol) and `@timmo001/effect-triage-client` (the client). One version covers the CLI and both libraries.
- Pin dependencies to exact versions (`bun add -E`).
- Run project tasks through mise. Scripts complex enough to need logic are written in Effect and exposed as mise tasks.
- Obfuscate everything sensitive before it leaves the machine, to any API: the triage server, decision models, LLMs or anything else. Redaction happens at capture in `src/redact.ts` and `src/journal/toEvent.ts`, so stored events never hold credentials, emails, home paths, user or host names, MAC or IP addresses, UUIDs and other machine IDs, serials or Wi-Fi names. Code that sends data anywhere sends only stored, redacted events, never raw journal fields, and new fields or sources must go through the `Redactor`.
- When a fix or diagnosis genuinely needs a redacted detail, collect it later on the source machine, at the point it's needed, rather than storing or sending it. The rule can be loosened only when everything stays internal: the same device, or a server and models on the same network. Anything going outside still gets the full redaction.

## Background Dev Servers

- Start a local server from source with `mise run serve:server`, which runs it through Pitchfork in the background in watch mode and restarts it if it stops responding. Do not run `triage serve` in the foreground from an agent.
- Use `mise run serve:server:status`, `serve:server:logs`, `serve:server:restart` and `serve:server:stop` to manage it, `mise run serve:server:enrol <name>` to enrol a host with it, and `mise run serve:server:admin <name>` and `serve:server:unadmin <name>` to add and remove an admin for testing the admin API or `/mcp`.
- The daemon is configured in `pitchfork.toml`. It serves `http://127.0.0.1:7172/` from `dev-server.db`, so it never touches a real server's port or database. If 7172 is taken it moves to the next free port; `mise run serve:server:status` shows which. With the Pitchfork proxy enabled it's always at `https://server.triage.localhost`.
- Start the web UI with `mise run serve:web`, which starts the background server too and runs `scripts/web-dev.ts` through Pitchfork. It serves `http://127.0.0.1:7180/` (`https://web.triage.localhost` through the Pitchfork proxy) and sends API requests to the server on 7172, or `TRIAGE_DEV_API`. Manage it with the matching `serve:web:status`, `serve:web:logs`, `serve:web:restart` and `serve:web:stop` tasks.
- Test through the Pitchfork proxy's HTTPS addresses, `https://server.triage.localhost` and `https://web.triage.localhost`, in the browser, with curl and anywhere else. Never add the proxy's own port, such as `:8443`, even if Pitchfork prints one: that means the 443 redirect is missing (it's lost on reboot), so run `pitchfork proxy doctor`, then `pitchfork proxy setup -y` to restore it. Use the `127.0.0.1` ports only when the proxy isn't running.
- Start the docs dev server with `mise run serve:docs:dev`, which runs it through Pitchfork in the background and restarts it if it exits or stops responding. Do not run `mise run docs:dev` or `blume dev` in the foreground from an agent. Manage it with the matching `serve:docs:status`, `serve:docs:logs`, `serve:docs:restart` and `serve:docs:stop` tasks. It serves `http://localhost:4321/`.

## Never Touch The Real Server

- The user's shell sets `TRIAGE_SERVER`, `TRIAGE_ADMIN_TOKEN` and sometimes `TRIAGE_WORKER_TOKEN` or `TRIAGE_TOKEN` for their production server. Every command with `--server` falls back to `TRIAGE_SERVER` when the flag is left out, so `bun run src/index.ts hosts add`, `admins add`, `resolve`, `label`, `decide`, `suggest`, `mcp` and the rest act on production even with `TRIAGE_SERVER_DB` set.
- From an agent, never run a server or token command against that environment. Use the `serve:server:*` tasks, which unset it. For anything else, unset it on the command itself and point at the dev server or a throwaway database explicitly:

  ```bash
  env -u TRIAGE_SERVER -u TRIAGE_ADMIN_TOKEN -u TRIAGE_WORKER_TOKEN -u TRIAGE_TOKEN TRIAGE_SERVER_DB=/tmp/opencode/test.db bun run src/index.ts <command>
  env -u TRIAGE_SERVER TRIAGE_ADMIN_TOKEN=<dev token> bun run src/index.ts <command> --server http://127.0.0.1:7172
  ```

- Before running one, check `printenv TRIAGE_SERVER` if you aren't sure. A printed URL that isn't `127.0.0.1` or `*.triage.localhost` is production.
- If a command reaches production by mistake, undo it straight away (for example `admins remove` for a token you added), and tell the user what happened and what you undid.

## Docs

- The docs site in `docs/` is built with Blume and deploys to `https://triage.timmo.dev`. Keep the README short and put the detail there.
- `mise run docs:gen` regenerates the command reference from the CLI's help and the design docs' token tables and swatches from `web/src/design.css`. Run it once, at the end of a change that touches commands, flags, arguments or their descriptions, or the design tokens. `mise run check` fails when the design docs are out of date, and CI fails when either is.
- The design pages mix generated regions, between `generated:<name>` and `/generated:<name>` comments, with hand-written prose. Edit only outside the regions, except for the hand-written "Used for" column, which regeneration keeps.

## Validation

Run these after source changes:

```bash
mise run check
mise run test
mise run build
mise run build:packages
```
