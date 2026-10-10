import { Option, Schema } from "effect";
import { type Kind, type Mark, placeholder, type Redact } from "../redact.js";

/** A name someone gave something in Home Assistant, and what kind it is. */
export type Name = readonly [name: string, kind: Kind];

/** What Home Assistant's registries name, for redacting from its logs. */
export interface Names {
  /** Every entity's ID, such as `light.kitchen`. */
  readonly entityIds: ReadonlyArray<string>;
  readonly names: ReadonlyArray<Name>;
}

const OptionalName = Schema.optionalKey(Schema.NullOr(Schema.String));

const Devices = Schema.Struct({
  data: Schema.Struct({
    devices: Schema.Array(
      Schema.Struct({
        name: OptionalName,
        name_by_user: OptionalName,
        entry_type: OptionalName,
      }),
    ),
  }),
});

const Entities = Schema.Struct({
  data: Schema.Struct({
    entities: Schema.Array(
      Schema.Struct({ entity_id: Schema.String, name: OptionalName }),
    ),
  }),
});

const Areas = Schema.Struct({
  data: Schema.Struct({
    areas: Schema.Array(Schema.Struct({ name: OptionalName })),
  }),
});

const Floors = Schema.Struct({
  data: Schema.Struct({
    floors: Schema.Array(Schema.Struct({ name: OptionalName })),
  }),
});

const People = Schema.Struct({
  data: Schema.Struct({
    items: Schema.Array(Schema.Struct({ name: OptionalName })),
  }),
});

/** Core's own settings in `core.config`, which name the home. */
const CoreSettings = Schema.Struct({
  data: Schema.Struct({ location_name: OptionalName }),
});

/** The files under `.storage` that hold names, by what they name. */
export const registryFiles = [
  ["devices", "core.device_registry"],
  ["entities", "core.entity_registry"],
  ["areas", "core.area_registry"],
  ["floors", "core.floor_registry"],
  ["people", "person"],
  ["config", "core.config"],
] as const;

export type Registries = {
  readonly [K in (typeof registryFiles)[number][0]]?: string;
};

const named = (
  items: ReadonlyArray<string | null | undefined>,
  kind: Kind,
): ReadonlyArray<Name> =>
  items.flatMap((name) =>
    name === null || name === undefined ? [] : [[name.trim(), kind] as const],
  );

/**
 * The names in Home Assistant's registries, from their JSON. Devices keep
 * their integration's name unless it's a service, such as the Sun or the
 * Supervisor, whose names aren't anyone's; entities only keep a name someone
 * gave them, since the rest come from their device and integration.
 */
export const parseRegistries = (registries: Registries): Names => {
  const read = <S extends Schema.Top & { readonly DecodingServices: never }>(
    json: string | undefined,
    schema: S,
  ): S["Type"] | undefined =>
    json === undefined
      ? undefined
      : Option.getOrUndefined(
          Schema.decodeOption(Schema.fromJsonString(schema))(json),
        );

  const devices = read(registries.devices, Devices)?.data.devices ?? [];
  const entities = read(registries.entities, Entities)?.data.entities ?? [];

  return {
    entityIds: entities.map((entity) => entity.entity_id),
    names: [
      ...named(
        devices.flatMap((device) => [
          device.name_by_user,
          device.entry_type === "service" ? undefined : device.name,
        ]),
        "device",
      ),
      ...named(
        entities.map((entity) => entity.name),
        "entity",
      ),
      ...named(
        (read(registries.areas, Areas)?.data.areas ?? []).map(
          (area) => area.name,
        ),
        "area",
      ),
      ...named(
        (read(registries.floors, Floors)?.data.floors ?? []).map(
          (floor) => floor.name,
        ),
        "floor",
      ),
      ...named(
        (read(registries.people, People)?.data.items ?? []).map(
          (person) => person.name,
        ),
        "user",
      ),
      ...named(
        [read(registries.config, CoreSettings)?.data.location_name],
        "home",
      ),
    ],
  };
};

/** Names this short are too likely to be part of something else. */
const shortest = 3;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Replace Home Assistant's names in its logs, marked with `mark`: each entity
 * ID's object ID, keeping its domain, as in `light.<entity>`, then the longest
 * names first, so `Kitchen lamp` goes before `Kitchen`. Names match their
 * case, since people write them capitalised and code doesn't, which keeps an
 * area named `Hue` from replacing the `hue` in loggers and paths.
 */
export const namesRedactor = (
  registry: Names,
  mark: Mark = placeholder,
): Redact => {
  const kinds = new Map(
    registry.names.filter(([name]) => name.length >= shortest),
  );

  const names = [...kinds.keys()].sort((a, b) => b.length - a.length);

  const entityIds =
    registry.entityIds.length === 0
      ? undefined
      : new RegExp(
          `(?<![\\w.])(?:${registry.entityIds.map(escape).join("|")})(?!\\w)`,
          "g",
        );

  const byName =
    names.length === 0
      ? undefined
      : new RegExp(`(?<!\\w)(?:${names.map(escape).join("|")})(?!\\w)`, "g");

  return (text) => {
    const withoutIds =
      entityIds === undefined
        ? text
        : text.replace(entityIds, (entityId) => {
            const dot = entityId.indexOf(".");

            // The domain stays in the text, so the token only stands for
            // the object ID after it.
            return `${entityId.slice(0, dot)}.${mark(
              "entity",
              entityId,
              entityId.slice(dot + 1),
            )}`;
          });

    return byName === undefined
      ? withoutIds
      : withoutIds.replace(byName, (name) => {
          const kind = kinds.get(name);

          return kind === undefined ? name : mark(kind, name);
        });
  };
};
