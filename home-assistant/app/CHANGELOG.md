## Privacy

Redaction keeps everything personal out of what's stored and sent, as before, but personal details can now be shown again where it's safe to:

- **Tokens.** Addresses, MAC addresses, user and host names, Wi-Fi networks, email addresses, serial numbers and Home Assistant's devices, entities, areas, floors and home become a token with a code, such as `<ip:71d0a3c2e94b>`, instead of a plain `<ip>`. The code comes from a key made on the machine that captured the event, which never leaves it, and the same value always gets the same code there. That machine keeps the value behind each code, and forgets it once nothing stored holds it. Credentials, UUIDs, long IDs and home directories stay plain placeholders, and nothing keeps them. Codes don't change how issues group.
- **The web UI through Home Assistant** shows the real value in place of each token it knows, underlined, with the token in its tooltip, in event messages, the lines logged before them, programs, units and warning examples. Only through Home Assistant: the server's own port never answers with values, even to an admin token, so agents, MCP and scripts only see tokens.
- **Models on your own network** can see the values with `TRIAGE_DECISION_INTERNAL` or `TRIAGE_LLM_INTERNAL`, when their API is on the same machine or a local address. Cloudflare, and OpenAI's and Anthropic's own APIs, never see them.
- **A server on your own network** can be sent a host's values with `TRIAGE_SERVER_INTERNAL`, so its web UI and models can show them too. Never a server anywhere else.

All three settings are off by default, and the log says when one is ignored because the address isn't local. See [Privacy](https://triage.timmo.dev/privacy).

Events captured before this release keep their plain placeholders, so only new events show values.

## API

- `POST /api/redactions`: hosts send the values behind their tokens, only with `TRIAGE_SERVER_INTERNAL`.
- `POST /api/redactions/resolve`: the values behind tokens, for the web UI, answered only through Home Assistant ingress.

