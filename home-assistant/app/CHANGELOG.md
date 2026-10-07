## Home Assistant

- The app keeps its MCP server in Home Assistant when it stops, so once you've added the integration it stays through restarts, updates and backups. 0.10.0 withdrew it on every stop.

## Server

- The server logs when it's starting, started, stopping and stopped.
- Each log entry is one line, so an HTTP request's method, URL and status sit next to its message instead of below it.

