// Checks every translation against English: the web UI's in web/translations
// and the Home Assistant app's in home-assistant/app/translations. Each needs
// the same keys and placeholders, and the plural forms its language uses. Also
// checks the web UI's message keys, which `--write` regenerates from English.
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Api } from "@timmo001/effect-triage";
import { Effect, FileSystem, Path, Schema } from "effect";

const webDir = "web/translations";

const keysFile = "web/src/messageKeys.ts";

const appDir = "home-assistant/app/translations";

const appConfig = "home-assistant/app/config.yaml";

const write = process.argv.includes("--write");

class TranslationsError extends Schema.TaggedError<TranslationsError>()(
  "TranslationsError",
  { message: Schema.String },
) {}

const decodeMessages = Schema.decodeUnknownEffect(
  Api.Translations.fields.messages,
);

const parseJsonc = (file: string, text: string) =>
  Effect.try({
    try: () => Bun.JSONC.parse(text),
    catch: (cause) =>
      new TranslationsError({
        message: `${file} isn't valid JSONC: ${String(cause)}`,
      }),
  });

const keysSource = (keys: ReadonlyArray<string>) =>
  [
    "// Generated from web/translations/en.jsonc by `mise run translations:gen`.",
    "",
    "/** A web UI message's key, from the English translation. */",
    "export type Key =",
    ...keys.map(
      (key, index) =>
        `  | ${JSON.stringify(key)}${index === keys.length - 1 ? ";" : ""}`,
    ),
    "",
  ].join("\n");

const AppTranslations = Schema.Struct({
  configuration: Schema.Record(
    Schema.String,
    Schema.Struct({ name: Schema.String, description: Schema.String }),
  ),
});

const AppConfig = Schema.Struct({
  schema: Schema.Struct({ language: Schema.String }),
});

const parseYaml = (file: string, text: string) =>
  Effect.try({
    try: () => Bun.YAML.parse(text),
    catch: (cause) =>
      new TranslationsError({
        message: `${file} isn't valid YAML: ${String(cause)}`,
      }),
  });

const placeholders = (text: string) =>
  [...text.matchAll(/\{(\w+)\}/g)].map(([, name]) => name).sort();

const same = (a: ReadonlyArray<string>, b: ReadonlyArray<string>) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

const texts = (message: Api.Message): ReadonlyArray<string> =>
  Schema.is(Schema.String)(message) ? [message] : Object.values(message);

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const problems: Array<string> = [];

  const files = (dir: string, extension: string) =>
    fs.readDirectory(dir).pipe(
      Effect.map((names) =>
        names
          .filter((name) => name.endsWith(extension))
          .map((name) => name.slice(0, -extension.length))
          .sort(),
      ),
    );

  const webLanguages = yield* files(webDir, ".jsonc");

  const readWeb = (language: string) => {
    const file = path.join(webDir, `${language}.jsonc`);

    return fs.readFileString(file).pipe(
      Effect.flatMap((text) => parseJsonc(file, text)),
      Effect.flatMap(decodeMessages),
      Effect.mapError(
        (cause) =>
          new TranslationsError({ message: `${file}: ${String(cause)}` }),
      ),
    );
  };

  const english = yield* readWeb("en");
  const keys = keysSource(Object.keys(english));

  if (write) {
    yield* fs.writeFileString(keysFile, keys);
  } else if (
    (yield* fs
      .readFileString(keysFile)
      .pipe(Effect.orElseSucceed(() => ""))) !== keys
  ) {
    problems.push(
      `${keysFile} doesn't match English. Run mise run translations:gen`,
    );
  }

  for (const language of webLanguages.filter((name) => name !== "en")) {
    const file = path.join(webDir, `${language}.jsonc`);
    const messages = yield* readWeb(language);

    const forms = new Intl.PluralRules(language).resolvedOptions()
      .pluralCategories;

    for (const key of Object.keys(english)) {
      if (!(key in messages)) {
        problems.push(`${file} is missing ${key}`);
      }
    }

    for (const [key, message] of Object.entries(messages)) {
      const source = english[key];

      if (source === undefined) {
        problems.push(`${file} has ${key}, which English doesn't`);
        continue;
      }

      const expected = placeholders(texts(source)[0] ?? "");

      for (const text of texts(message)) {
        if (!same(placeholders(text), expected)) {
          problems.push(
            `${file}'s ${key} should use ${expected.map((name) => `{${name}}`).join(", ") || "no placeholders"}: ${text}`,
          );
        }
      }

      if (
        Schema.is(Schema.String)(source) !== Schema.is(Schema.String)(message)
      ) {
        problems.push(
          `${file}'s ${key} should ${Schema.is(Schema.String)(source) ? "be plain text" : "have plural forms"}`,
        );
      } else if (!Schema.is(Schema.String)(message)) {
        const missing = forms.filter((form) => !(form in message));

        if (missing.length > 0) {
          problems.push(
            `${file}'s ${key} needs the ${missing.join(", ")} plural forms`,
          );
        }
      }
    }
  }

  const readApp = (language: string) => {
    const file = path.join(appDir, `${language}.yaml`);

    return fs.readFileString(file).pipe(
      Effect.flatMap((text) => parseYaml(file, text)),
      Effect.flatMap(Schema.decodeUnknownEffect(AppTranslations)),
      Effect.mapError(
        (cause) =>
          new TranslationsError({ message: `${file}: ${String(cause)}` }),
      ),
    );
  };

  const appLanguages = yield* files(appDir, ".yaml");
  const appEnglish = Object.keys((yield* readApp("en")).configuration).sort();

  for (const language of appLanguages.filter((name) => name !== "en")) {
    const options = Object.keys(
      (yield* readApp(language)).configuration,
    ).sort();

    if (!same(options, appEnglish)) {
      problems.push(
        `${path.join(appDir, `${language}.yaml`)} should have the options ${appEnglish.join(", ")}`,
      );
    }
  }

  if (!same(appLanguages, webLanguages)) {
    problems.push(
      `${appDir} should have the same languages as ${webDir}: ${webLanguages.join(", ")}`,
    );
  }

  const config = yield* fs.readFileString(appConfig).pipe(
    Effect.flatMap((text) => parseYaml(appConfig, text)),
    Effect.flatMap(Schema.decodeUnknownEffect(AppConfig)),
    Effect.mapError(
      (cause) =>
        new TranslationsError({ message: `${appConfig}: ${String(cause)}` }),
    ),
  );

  const listed = /^list\((.*)\)\??$/
    .exec(config.schema.language)?.[1]
    ?.split("|")
    .sort();

  if (listed === undefined || !same(listed, webLanguages)) {
    problems.push(
      `${appConfig}'s language option should list ${webLanguages.join("|")}`,
    );
  }

  if (problems.length > 0) {
    return yield* new TranslationsError({ message: problems.join("\n") });
  }

  yield* Effect.log(
    `The translations match English in ${webLanguages.length} languages`,
  );
});

program.pipe(Effect.provide(BunServices.layer), BunRuntime.runMain);
