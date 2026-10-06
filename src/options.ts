import {
  Config,
  ConfigProvider,
  Effect,
  FileSystem,
  Option,
  Predicate,
  Schema,
} from "effect";

const Options = Schema.fromJsonString(
  Schema.Record(Schema.String, Schema.Unknown),
);

/**
 * Settings from the JSON file at `$TRIAGE_OPTIONS`, such as a Home Assistant
 * app's `/data/options.json`, behind the environment. Keys are lowercase,
 * without the `TRIAGE_` prefix: `decide_daily` sets `TRIAGE_DECIDE_DAILY` and
 * `cloudflare_api_token` sets `CLOUDFLARE_API_TOKEN`.
 */
export const layerOptions = ConfigProvider.layerAdd(
  Effect.gen(function* () {
    const file = yield* Config.option(Config.String("TRIAGE_OPTIONS"));

    if (Option.isNone(file)) {
      return ConfigProvider.fromUnknown({});
    }

    const fs = yield* FileSystem.FileSystem;

    const options = yield* Schema.decodeEffect(Options)(
      yield* fs.readFileString(file.value),
    );

    return ConfigProvider.fromUnknown(options).pipe(
      ConfigProvider.mapInput((path) =>
        path.map((segment) =>
          Predicate.isString(segment)
            ? segment.toLowerCase().replace(/^triage_/, "")
            : segment,
        ),
      ),
    );
  }),
);
