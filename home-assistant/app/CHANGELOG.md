## Home Assistant

- Entity IDs in the web UI through Home Assistant showed their domain twice, as in `sensor.sensor.example`, since the value behind an entity ID's token was the whole ID while its domain stays in the text. It's now only the object ID, and a migration fixes the values already kept.
