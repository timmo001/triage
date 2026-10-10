## Home Assistant

- The app reads Home Assistant's config directory, read only, and takes the names in its registries out of Core's errors: entity IDs become `light.<entity>`, and the names of devices, entities, areas, floors, people and your home become `<device>`, `<entity>`, `<area>`, `<floor>`, `<user>` and `<home>`. The same error for two devices is now one issue. It only reads the registries in `.storage`, `.HA_VERSION` and custom integrations' manifests, never `secrets.yaml` or anything else. See [Privacy](https://triage.timmo.dev/privacy).
- Core's errors come with the version of Core that logged them, and a custom integration's version and a link to its issue tracker.
- The issues page says when the app can't read the host journal, so Core's errors aren't being collected, rather than only logging it.

## API

- `GET /api/hosts/collection` says how the server's own collection of Home Assistant Core's errors is going.
- An event's `integration` can have a custom integration's `version` and `issueTracker`.

