## CLI

- **Read issues from the CLI.** `triage issue <id>` shows an issue's hosts, decisions, suggested fixes, notes, nearby issues and latest events, `triage events <id>` pages through its events, and `triage similar <id>` finds issues like it and how they were fixed. Each takes `--json`, and reads the server in `$TRIAGE_SERVER` or `--server`.
- **Filter `triage issues`** with `--search`, `--state`, `--kind`, `--host` and `--label` (repeat any of the last four for several), sort with `--sort` and `--order`, and page with `--offset`.
- **Issue links work everywhere.** Every command that takes an issue also takes a link to its page, as the MCP tools already did.

## Agents

- **The `triage-resolve` skill** maps each MCP tool to its CLI command, so agents without the MCP server can follow it too.

## Dependencies

- oxlint 1.90.0 and other dependency updates.

