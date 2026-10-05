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

## Validation

Run these after source changes:

```bash
mise run check
mise run test
mise run build
mise run build:packages
```
