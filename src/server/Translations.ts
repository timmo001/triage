import { Api } from "@timmo001/effect-triage";
import { Context, Effect, Layer, Schema } from "effect";
import { bundleTranslations } from "./translationsBundle.js" with { type: "macro" };

const files = bundleTranslations();

/** The languages the web UI has been translated into. */
export const languages = Object.keys(files).sort();

const decodeMessages = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Api.Translations.fields.messages),
);

/** The web UI's text in the language the server is set to. */
export class Translations extends Context.Service<
  Translations,
  Api.Translations
>()("triage/server/Translations") {
  /** The translations for `language`, which must be one of `languages`. */
  static readonly layer = (language: string) =>
    Layer.effect(
      Translations,
      Effect.gen(function* () {
        const file = files[language];

        if (file === undefined) {
          return yield* Effect.die(
            new Error(
              `There's no ${language} translation. Set TRIAGE_LANGUAGE to one of: ${languages.join(", ")}`,
            ),
          );
        }

        const messages = yield* decodeMessages(file).pipe(Effect.orDie);

        return Translations.of({ language, messages });
      }),
    );
}
