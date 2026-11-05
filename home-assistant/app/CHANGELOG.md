The web UI moves onto Groundwork, with a theme picker, and agents can filter and open issues in it through WebMCP.

## Web UI

- **Groundwork themes**: the web UI is themed with Groundwork, and a theme picker lets you choose another theme. Triage's own theme is still offered.
- The search, filters, issue list toolbar, sort and group menus, sign-in form, badges, loading skeletons and messages use Groundwork's components, and its scrollbars replace Triage's own.

## Agents

- **WebMCP tools**: `filter-issues` filters the issue list and `open-issue` opens an issue. `set-theme` offers Triage's theme.

## Home Assistant

- Supervisor log records with a UTC offset in their timestamp are read correctly. Reviewed against Supervisor 2026.10.5.

## Libraries

- `@timmo001/effect-triage` and `@timmo001/effect-triage-client` accept any Effect 4 release from 4.1.2 as their `effect` peer, instead of exactly 4.1.2.

## Docs

- The docs use Groundwork's Snag theme.

## Dependencies

- Effect 4.1.2, cloudflared 2026.10.7 in the Cloudflare Tunnel compose file, and development dependency updates.

**Full Changelog**: https://github.com/timmo001/triage/compare/0.20.1...0.21.0

