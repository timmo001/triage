---
name: triage-release
description: Version and release triage and its published libraries, @timmo001/effect-triage and @timmo001/effect-triage-client. Use when bumping versions, preparing or publishing a GitHub release, debugging the Release workflow, or setting up the npm and JSR packages with registries:setup.
license: Apache-2.0
compatibility: Requires mise, Bun and the GitHub CLI from the triage repository root.
---

# Releasing triage

One version covers the CLI and both libraries. A published, non-prerelease GitHub release runs `.github/workflows/release.yml`, which publishes `@timmo001/effect-triage` then `@timmo001/effect-triage-client` to npm and JSR through OIDC, with no tokens. Prereleases publish nothing.

## Bump the version

The publish workflows fail unless the release tag exactly matches every manifest, with no `v` prefix. Set the same version in:

- `package.json` (the CLI reads `--version` from it)
- `packages/effect-triage/package.json` and `packages/effect-triage/jsr.json`
- `packages/client/package.json` and `packages/client/jsr.json`

Then run `mise run version:sync` to pin the client's `@timmo001/effect-triage` dependency to it, and `bun install` to refresh `bun.lock`; CI installs with `--frozen-lockfile`. Run `mise run check`, `mise run test`, `mise run build` and `mise run build:packages` before committing.

Releasing is a public, irreversible publish. Commit, push and create the release only when the user asks for each step, and use their chosen version.

## Registries

Every package in `packages/` needs an npm package that trusts `release.yml` and a JSR package linked to the repository before its first release. `mise run registries:setup` does both and skips what's already done. The user runs it by hand: it needs `npm login`, 2FA prompts and a short-lived JSR token with full access in `JSR_TOKEN`, deleted afterwards. Run it again whenever a package is added.

## Packaging

Linux binaries and Arch packages aren't set up yet. When they are, copy them from ha-bridge's `.scripts/linux/` and release jobs, and install only published packages from the signed `timmo` pacman repository, never a local build.
