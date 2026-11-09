OpenCode can use triage's issue tools as a `triage` Code Mode namespace, through the new `triage agent` commands and an OpenCode plugin.

## Agents

- **`triage agent tools`** prints the MCP server's issue tools as Code Mode tools in JSON, and whether `$TRIAGE_SERVER` and `$TRIAGE_ADMIN_TOKEN` are set to call them with. **`triage agent call <tool>`** runs one with its input as JSON on stdin and prints its result as JSON, on the server in `$TRIAGE_SERVER` or `--server`, or the server database on this machine.
- **OpenCode plugin**: `opencode-plugin/` registers those tools as a `triage` Code Mode namespace, so an agent can chain them in one script. Load it with `github:timmo001/triage#main::path:opencode-plugin`; it needs triage 0.22.0 or later on your `PATH`. Tools that change something ask first: "Always allow" on `set_issue_status`, `add_issue_note` or `label_issue` covers one issue, and `merge_issues` asks every time. See [Agents](https://triage.timmo.dev/agents).

## Home Assistant

- Reviewed against Supervisor 2026.11.0, with no changes needed.

## Server

- The Caddy compose file uses the latest `caddy:2` image.

## Dependencies

- Groundwork 0.20.0 for the web UI, and development dependency updates.

**Full Changelog**: https://github.com/timmo001/triage/compare/0.21.0...0.22.0

