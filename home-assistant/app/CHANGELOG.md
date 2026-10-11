## Performance

- Events are stored a batch at a time, with one lookup and insert per batch and one update per issue, rather than three or four statements for every event, so hosts catching up on a long journal upload much faster.
- A new index on each issue's hosts means listing issues, filtering them by host and the hosts summary no longer read every event. A migration adds it on first start.
- Warning counts read their version once per batch, and expired ones are only cleared when there are some.
- Issue IDs are hashed without BigInt, and the tokens for values that come up again and again, like host and program names, are kept rather than worked out each time. Issue IDs and tokens are unchanged.
- Reading the journal takes a step less per line.
- The web UI's bigger files are sent gzipped to browsers that take it.

## Home Assistant

- Attributing events to Home Assistant's version and custom integrations only reads `.HA_VERSION` and their manifests again when they change.
- The images are built with Bun 1.4.3.

