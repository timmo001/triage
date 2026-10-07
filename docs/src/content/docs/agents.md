---
title: Agents
description: Let an agent find issues, read them and every event in them, see how similar ones were fixed, and resolve, mute or label them, through triage's MCP server.
---

Triage serves [MCP](https://modelcontextprotocol.io), so an agent can find and read issues and their events, then resolve, mute or label them. Give it an issue ID or paste a link to the issue's page, and it reads the rest itself, or let it search for one. The issue page's **Copy for agent** button copies the link with a line telling the agent which tools to use.

The tools see what the web UI does: redacted events, the names hosts were enrolled with, decisions and suggested fixes. They can change what the issue page's buttons change, and nothing else.

| Tool | Does |
| --- | --- |
| `list_issues` | Issues, the latest seen first, filtered by title, state, kind, host or label like the web UI's list, and sorted the same ways. Pass `nextOffset` back until it's missing to page through them |
| `get_issue` | The issue, the hosts it happened on, decisions, suggested fixes and its latest 20 events |
| `get_issue_events` | A page of its events, newest first, up to 500 at a time. Pass `nextOffset` back until it's missing to read them all |
| `find_similar_issues` | Issues like it, with the fixes suggested for each, resolved ones first |
| `set_issue_status` | Resolves, mutes or reopens the issue |
| `label_issue` | Labels the issue worth fixing or noise |

`find_similar_issues` counts an issue as similar when it's a crash of the same program with the same signal, the same unit failing in any way, another error from the same program, or another OOM kill.

The server tells agents to close an issue once they've fixed it, without waiting to be asked. Each host the issue happened on needs the fix, so the agent checks it's in place on the hosts it can reach and asks you about the others. Then it asks you before resolving the issue. Issues that are noise and can't be fixed get muted instead.

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

The [Home Assistant app](/setup/server#home-assistant) announces its MCP server to Home Assistant, which offers to add it under **Settings > Devices & services**. Once it's added, turn on its tools for your conversation agent, and Assist can read, resolve, mute and label issues too.

Home Assistant reaches it on the app's ingress port, which lets Home Assistant Core use `/mcp` without a token. If Home Assistant can't connect, the app's log says which address it refused: set `TRIAGE_INGRESS_MCP_FROM` to it.
