import { Event } from "@timmo001/effect-triage";
import {
  Context,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Schema,
} from "effect";
import { Redactor, type Redact } from "../redact.js";
import {
  namesRedactor,
  parseRegistries,
  type Registries,
  registryFiles,
} from "./names.js";

/**
 * Where the Supervisor mounts Home Assistant's config directory, read only,
 * with `homeassistant_config` in the app's `map`.
 */
const configDirectory = "/homeassistant";

const Manifest = Schema.Struct({
  version: Schema.optionalKey(Schema.String),
  issue_tracker: Schema.optionalKey(Schema.String),
});

/** A file's text and when it last changed, in milliseconds since the epoch. */
interface Stamped {
  readonly text: string;
  readonly mtime: number;
}

/**
 * Reads what Home Assistant's logs don't say from its config directory: the
 * names in its registries, to redact from its errors, the version of Core
 * that's running and custom integrations' manifests. Only those files are
 * read, never `secrets.yaml` or anything else there. Outside a Home Assistant
 * app, or without the mount, there are no names and no versions.
 */
export class HomeAssistantConfig extends Context.Service<
  HomeAssistantConfig,
  {
    /** Whether Home Assistant's config directory is there to read. */
    readonly mounted: boolean;
    /** Redacts the registries' current names, as Home Assistant logs them. */
    readonly redactNames: Effect.Effect<Redact>;
    /**
     * Adds Core's version, and a custom integration's version and issue
     * tracker, to an event. Only once they were installed, since an older
     * event could be from an earlier version.
     */
    readonly attribute: (event: Event.Event) => Effect.Effect<Event.Event>;
  }
>()("triage/homeassistant/HomeAssistantConfig") {
  static readonly layer = Layer.effect(
    HomeAssistantConfig,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { redact, mark } = yield* Redactor;

      const mounted = yield* fs
        .exists(configDirectory)
        .pipe(Effect.orElseSucceed(() => false));

      const mtimeOf = (file: string) =>
        fs.stat(file).pipe(
          Effect.map((info) =>
            Option.match(info.mtime, {
              onNone: () => 0,
              onSome: (date) => date.getTime(),
            }),
          ),
          Effect.option,
        );

      const read = Effect.fnUntraced(function* (file: string) {
        const mtime = yield* mtimeOf(file);

        if (Option.isNone(mtime)) {
          return Option.none<Stamped>();
        }

        return yield* fs.readFileString(file).pipe(
          Effect.map((text) => ({ text, mtime: mtime.value })),
          Effect.option,
        );
      });

      const storage = (name: string) =>
        path.join(configDirectory, ".storage", name);

      // The registries change whenever something is renamed, so they're read
      // again once any of them has changed.
      let stamps = "";
      let redactNames: Redact = (text) => text;

      const refreshNames = Effect.gen(function* () {
        if (!mounted) {
          return redactNames;
        }

        const mtimes = yield* Effect.forEach(registryFiles, ([, file]) =>
          mtimeOf(storage(file)),
        );

        const current = mtimes
          .map((mtime) => Option.getOrElse(mtime, () => 0))
          .join(",");

        if (current === stamps) {
          return redactNames;
        }

        const files = yield* Effect.forEach(registryFiles, ([key, file]) =>
          read(storage(file)).pipe(Effect.map((file) => [key, file] as const)),
        );

        const registries: Registries = Object.fromEntries(
          files.flatMap(([key, file]) =>
            Option.isSome(file) ? [[key, file.value.text]] : [],
          ),
        );

        stamps = current;
        redactNames = namesRedactor(parseRegistries(registries), mark);

        return redactNames;
      });

      const coreVersion = Effect.gen(function* () {
        const file = yield* read(path.join(configDirectory, ".HA_VERSION"));

        return Option.flatMap(file, ({ text, mtime }) => {
          const version = text.trim();

          return version === ""
            ? Option.none()
            : Option.some({ version: redact(version), since: mtime });
        });
      });

      const manifestOf = Effect.fnUntraced(function* (domain: string) {
        const file = yield* read(
          path.join(
            configDirectory,
            "custom_components",
            domain,
            "manifest.json",
          ),
        );

        return Option.flatMap(file, ({ text, mtime }) =>
          Schema.decodeOption(Schema.fromJsonString(Manifest))(text).pipe(
            Option.map((manifest) => ({ manifest, since: mtime })),
          ),
        );
      });

      const attribute = Effect.fnUntraced(function* (event: Event.Event) {
        if (!mounted) {
          return event;
        }

        const core = yield* coreVersion;
        const integration = event.integration;

        const custom =
          integration?.custom === true
            ? yield* manifestOf(integration.domain)
            : Option.none();

        const withPackage = Option.match(core, {
          onNone: () => event,
          onSome: ({ version, since }) =>
            event.timestamp >= since
              ? { ...event, package: { name: "homeassistant", version } }
              : event,
        });

        return Option.match(custom, {
          onNone: () => withPackage,
          onSome: ({ manifest, since }) =>
            integration === undefined
              ? withPackage
              : {
                  ...withPackage,
                  integration: {
                    ...integration,
                    ...(manifest.version !== undefined &&
                      event.timestamp >= since && {
                        version: redact(manifest.version),
                      }),
                    ...(manifest.issue_tracker !== undefined && {
                      issueTracker: redact(manifest.issue_tracker),
                    }),
                  },
                },
        });
      });

      return HomeAssistantConfig.of({
        mounted,
        redactNames: refreshNames,
        attribute,
      });
    }),
  );
}
