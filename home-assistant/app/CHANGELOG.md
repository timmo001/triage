## Agents over MCP

- New `triage mcp` serves an MCP server over stdio, so an agent can read an issue and all its events from an issue ID or a link to its page. It reads the server at `TRIAGE_SERVER` as the admin in `TRIAGE_ADMIN_TOKEN`, or this machine's server database when `TRIAGE_SERVER` isn't set.
- The server serves the same tools at `/mcp` over Streamable HTTP, to admins only.
- Two read-only tools: `get_issue` for the issue, its hosts, decisions, suggested fixes and latest 20 events, and `get_issue_events` for every event, a page at a time.
- The issue page has a **Copy for agent** button, which copies the link with a line telling the agent which tools to use.
- See [Agents](https://triage.timmo.dev/agents) for setting it up in OpenCode and elsewhere.

## Home Assistant

- The app announces its MCP server to Home Assistant, which offers to add it under **Settings > Devices & services**. Turn on its tools for your conversation agent and Assist can read issues too.
- Home Assistant Core reaches `/mcp` on the ingress port without a token. New `TRIAGE_INGRESS_MCP_FROM` sets the address it's allowed from, `172.30.32.1` by default. If Home Assistant can't connect, the app's log says which address it refused.

## Web UI

- Event cards are reworked: the severity sits above the message with its icon and colour, then the time, then a row of compact badges you can scroll or drag sideways.
- The stack trace and logged lines dropdowns show a preview of their first frame or last line.
- An issue's events load 20 at a time as you scroll, in a virtual list, so issues with lots of events stay quick. The heading is now **Events** rather than **Latest events**.
- Skeletons show while an issue and its events load.
- Issue rows and checkboxes are centred, and the filter counts use the standard badge.
- Fonts, colours, spacing and corner radii come from one set of design tokens, with more vivid colours on wide-gamut screens.

## API and libraries

- New `GET /api/issues/:id/events` for admins, with `limit` and `offset`, returning the issue's events newest first and how many it has in all. `@timmo001/effect-triage` adds `Api.IssueEvents`, `Api.latestEvents` and `Api.maxEventPage`.

