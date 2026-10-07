## MCP

- Agents can search issues with `list_issues`, and find issues like one they're looking at with `find_similar_issues`.
- The server has a matching `GET /api/issues/:id/similar` endpoint, and `@timmo001/effect-triage` adds `SimilarIssue` for it.

## Home Assistant

- The app withdraws its MCP server from Home Assistant when it stops, and offers it again when it starts.
- The server exits cleanly when it's stopped, so the Supervisor no longer logs an error each time the app stops or updates.

