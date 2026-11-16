# Triage docs

The [Triage](https://github.com/timmo001/triage) documentation site, built with Blume and Astro. It's available at <https://triage.timmo.dev>.

## Commands

Run these from the repository root:

- `mise run docs:dev`: run the dev server
- `mise run docs:build`: build the site
- `mise run docs:preview`: preview the built site
- `mise run docs:gen`: regenerate the command reference from the CLI's help and the design pages from the web UI's tokens
- `mise run docs:plan`: build the site, then show what deploying it would change
- `mise run docs:deploy`: build the site, then deploy it

Shared layout, components and config defaults come from [`@timmo001/docs-kit`](https://github.com/timmo001/docs-kit). Run `bun run brand` in `docs` to regenerate `public/logo.png`, `public/apple-touch-icon.png` and the GitHub social preview from `src/assets/logo.svg`.

## Deployment

The site deploys to Cloudflare Workers with Blume's Astro server bundle, which also serves the read-only docs MCP at `/mcp`. The Alchemy stack in `alchemy.run.ts` owns the `triage-docs` Worker, its compatibility settings and custom domain, and the Deploy docs workflow deploys it on every push to `main`.

CI's Cloudflare token and the repository secrets it reads come from `stacks/github.ts`. Deploy that once, and again to rotate the token, with `mise run docs:deploy:github`.
