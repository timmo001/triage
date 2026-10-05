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

## Validation

Run these after source changes:

```bash
mise run check
mise run test
mise run build
mise run build:packages
```
