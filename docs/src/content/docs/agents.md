---
title: Agents
description: Let an agent read an issue and every event in it through triage's MCP server.
---

Triage serves [MCP](https://modelcontextprotocol.io), so an agent can read an issue and its events. Give it an issue ID or paste a link to the issue's page, and it reads the rest itself. The issue page's **Copy for agent** button copies the link with a line telling the agent which tools to use.

The tools only read. They see what the web UI does: redacted events, the names hosts were enrolled with, decisions and suggested fixes.

| Tool | Reads |
| --- | --- |
| `get_issue` | The issue, the hosts it happened on, decisions, suggested fixes and its latest 20 events |
| `get_issue_events` | A page of its events, newest first, up to 500 at a time. Pass `nextOffset` back until it's missing to read them all |

## Over stdio

`triage mcp` serves the tools to an agent that starts it. It reads the server at `TRIAGE_SERVER` as the admin in `TRIAGE_ADMIN_TOKEN`, or the server database on this machine when `TRIAGE_SERVER` isn't set. For OpenCode:

```json
{
  "mcp": {
    "triage": {
      "type": "local",
      "command": ["triage", "mcp"],
      "environment": {
        "TRIAGE_SERVER": "https://triage.example.com",
        "TRIAGE_ADMIN_TOKEN": "{env:TRIAGE_ADMIN_TOKEN}"
      }
    }
  }
}
```

## Over HTTP

The server also serves the tools at `/mcp`, over Streamable HTTP, to anything with an admin token:

```json
{
  "mcp": {
    "triage": {
      "type": "remote",
      "url": "https://triage.example.com/mcp",
      "headers": { "Authorization": "Bearer {env:TRIAGE_ADMIN_TOKEN}" }
    }
  }
}
```

## Home Assistant

The [Home Assistant app](/setup/server#home-assistant) announces its MCP server to Home Assistant, which offers to add it under **Settings > Devices & services**. Once it's added, turn on its tools for your conversation agent, and Assist can read issues too.

Home Assistant reaches it on the app's ingress port, which lets Home Assistant Core use `/mcp` without a token. If Home Assistant can't connect, the app's log says which address it refused: set `TRIAGE_INGRESS_MCP_FROM` to it.
