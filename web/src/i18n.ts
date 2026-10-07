import { Api } from "@timmo001/effect-triage";
import { Context, Effect, Layer, Predicate, Schedule } from "effect";
import { FetchHttpClient, HttpClient } from "effect/http";
import { HttpApiClient } from "effect/http-api";
import type { TemplateResult } from "lit";
import type { Key } from "./messageKeys.js";

/** The web UI's text in the language the server is set to. */
export class Translations extends Context.Service<
  Translations,
  Api.Translations
>()("triage/web/Translations") {
  /** Fetches the translations from the server the page came from. */
  static readonly layer = Layer.effect(
    Translations,
    Effect.gen(function* () {
      const client = yield* HttpApiClient.group(Api.Api, {
        group: "system",
        httpClient: (yield* HttpClient.HttpClient).pipe(
          HttpClient.retryTransient({
            schedule: Schedule.exponential("250 millis"),
            times: 5,
          }),
        ),
        baseUrl: new URL(".", document.baseURI).href.replace(/\/$/, ""),
      });

      return Translations.of(yield* client.translations());
    }),
  ).pipe(Layer.provide(FetchHttpClient.layer));
}

let current: Api.Translations | undefined;

/**
 * Loads the translations, which `t` and `language` need, and sets the page's
 * language to match.
 */
export const load = Effect.gen(function* () {
  current = yield* Translations;
  document.documentElement.lang = current.language;
}).pipe(Effect.provide(Translations.layer));

const loaded = () => {
  if (current === undefined) {
    throw new Error("The translations haven't loaded yet");
  }

  return current;
};

/** The language the UI is in, such as `en` or `pt-BR`. */
export const language = () => loaded().language;

let plurals: Intl.PluralRules | undefined;

/**
 * A message in the UI's language, with each `{name}` replaced by `params`. A
 * message with plural forms picks one by `params.count`.
 */
export const t = (
  key: Key,
  params: Readonly<Record<string, string | number>> = {},
): string =>
  pick(key, params["count"]).replace(
    /\{(\w+)\}/g,
    (placeholder, name: string) => String(params[name] ?? placeholder),
  );

/**
 * A message in the UI's language as parts, with each `{name}` replaced by
 * `params`, which may be templates, such as a `<code>` element.
 */
export const parts = (
  key: Key,
  params: Readonly<Record<string, string | number | TemplateResult>>,
): ReadonlyArray<string | number | TemplateResult> =>
  pick(key, params["count"])
    .split(/(\{\w+\})/)
    .map((part) => {
      const name = /^\{(\w+)\}$/.exec(part)?.[1];

      return (name === undefined ? undefined : params[name]) ?? part;
    });

const pick = (
  key: Key,
  count: string | number | TemplateResult | undefined,
) => {
  const message = loaded().messages[key];

  if (message === undefined) {
    return key;
  }

  if (Predicate.isString(message)) {
    return message;
  }

  plurals ??= new Intl.PluralRules(language());

  return message[plurals.select(Number(count ?? 0))] ?? message.other;
};
