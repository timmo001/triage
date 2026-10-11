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

      // Each file's last read, given back while its mtime hasn't changed, so
      // attributing an event only stats the version and manifest files
      // rather than reading and parsing them again.
      const reads = new Map<string, Stamped>();

      const read = Effect.fnUntraced(function* (file: string) {
        const mtime = yield* mtimeOf(file);

        if (Option.isNone(mtime)) {
          reads.delete(file);

          return Option.none<Stamped>();
        }

        const cached = reads.get(file);

        if (cached !== undefined && cached.mtime === mtime.value) {
          return Option.some(cached);
        }

        const stamped = yield* fs.readFileString(file).pipe(
          Effect.map((text): Stamped => ({ text, mtime: mtime.value })),
          Effect.option,
        );

        if (Option.isSome(stamped)) {
          reads.set(file, stamped.value);
        } else {
          reads.delete(file);
        }

        return stamped;
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

      /** What was last made of a file's text, while the text is the same. */
      const parsed = <A>(parse: (file: Stamped) => Option.Option<A>) => {
        const results = new Map<
          string,
          { text: string; result: Option.Option<A> }
        >();

        return (file: string) =>
          Effect.map(read(file), (stamped) => {
            if (Option.isNone(stamped)) {
              results.delete(file);

              return Option.none<A>();
            }

            const last = results.get(file);

            if (last !== undefined && last.text === stamped.value.text) {
              return last.result;
            }

            const result = parse(stamped.value);

            results.set(file, { text: stamped.value.text, result });

            return result;
          });
      };

      const versionOf = parsed(({ text, mtime }) => {
        const version = text.trim();

        return version === ""
          ? Option.none()
          : Option.some({ version: redact(version), since: mtime });
      });

      const coreVersion = versionOf(path.join(configDirectory, ".HA_VERSION"));

      const decodeManifest = Schema.decodeOption(
        Schema.fromJsonString(Manifest),
      );

      const parseManifest = parsed(({ text, mtime }) =>
        Option.map(decodeManifest(text), (manifest) => ({
          manifest,
          since: mtime,
        })),
      );

      const manifestOf = (domain: string) =>
        parseManifest(
          path.join(
            configDirectory,
            "custom_components",
            domain,
            "manifest.json",
          ),
        );

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
