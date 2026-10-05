import { AnthropicClient, AnthropicLanguageModel } from "@effect/ai-anthropic";
import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai-compat";
import { Issue } from "@timmo001/effect-triage";
import { Config, Context, Effect, Layer, Option, Schema } from "effect";
import { LanguageModel, Prompt } from "effect/ai";
import { FetchHttpClient } from "effect/http";
import { IssueNotFound, Store } from "../store/Store.js";
import { toState } from "./Triager.js";

/**
 * Which API writes suggestions: any OpenAI-compatible or Anthropic-compatible
 * one, or Workers AI on Cloudflare.
 */
export const LlmProvider = Schema.Literals([
  "openai",
  "anthropic",
  "cloudflare",
]);

export type LlmProvider = typeof LlmProvider.Type;

/**
 * The longest response, to keep each suggestion's cost predictable. Reasoning
 * models count their thinking against it, so it's well above the reply itself.
 */
const maxOutput = 4096;

const instructions = `You help someone fix a crash or error on their own Linux machine, often Arch Linux with the Omarchy Hyprland desktop. You're given an issue grouped from the system journal, with sample messages and, for crashes, the top stack frames. Personal details were redacted before you saw them: <user>, <host>, <ip>, <mac>, <uuid>, <id>, <email>, <redacted>, and ~ for the home directory.

Reply in Markdown, in under 250 words:
1. The most likely cause, in one or two sentences.
2. Numbered steps to confirm and fix it, with the exact commands to run.

Say when the details aren't enough to be sure, and what to check next. Don't invent package names, options or file paths.`;

export interface Suggestion {
  readonly issue: Issue.Issue;
  /** The model that wrote it, as `provider/model`. */
  readonly model: string;
  readonly text: string;
}

/**
 * Asks a language model how to fix an issue, from its stored, redacted
 * events only.
 */
export class Suggester extends Context.Service<
  Suggester,
  {
    suggest(
      issueId: string,
    ): Effect.Effect<Suggestion, Effect.Error<ReturnType<typeof suggestFor>>>;
  }
>()("triage/triage/Suggester") {
  /**
   * The API at `url`, with `$TRIAGE_LLM_API_KEY` when it needs one, or
   * Workers AI with `$CLOUDFLARE_ACCOUNT_ID` and `$CLOUDFLARE_API_TOKEN`.
   */
  static readonly layer = (options: {
    readonly provider: LlmProvider;
    readonly url: Option.Option<string>;
    readonly model: string;
  }) =>
    Layer.effect(
      Suggester,
      Effect.gen(function* () {
        const store = yield* Store;
        const model = yield* LanguageModel.LanguageModel;
        const name = `${options.provider}/${options.model}`;

        return Suggester.of({
          suggest: (issueId) => suggestFor(store, model, name, issueId),
        });
      }),
    ).pipe(
      Layer.provide(
        languageModel(options).pipe(Layer.provide(FetchHttpClient.layer)),
      ),
    );
}

const apiKey = Config.Redacted("TRIAGE_LLM_API_KEY").pipe(
  Config.withDefault(undefined),
);

const languageModel = (options: {
  readonly provider: LlmProvider;
  readonly url: Option.Option<string>;
  readonly model: string;
}) => {
  switch (options.provider) {
    case "anthropic":
      return AnthropicLanguageModel.layer({
        model: options.model,
        config: { max_tokens: maxOutput },
      }).pipe(
        Layer.provide(
          AnthropicClient.layerConfig({
            apiKey,
            apiUrl: Config.succeed(
              Option.getOrElse(options.url, () => "https://api.anthropic.com"),
            ),
          }),
        ),
      );
    case "cloudflare":
      return OpenAiLanguageModel.layer({
        model: options.model,
        config: { max_output_tokens: maxOutput },
      }).pipe(
        Layer.provide(
          OpenAiClient.layerConfig({
            apiKey: Config.Redacted("CLOUDFLARE_API_TOKEN"),
            apiUrl: Config.String("CLOUDFLARE_ACCOUNT_ID").pipe(
              Config.map(
                (account) =>
                  `https://api.cloudflare.com/client/v4/accounts/${account}/ai/v1`,
              ),
            ),
          }),
        ),
      );
    case "openai":
      return OpenAiLanguageModel.layer({
        model: options.model,
        config: { max_output_tokens: maxOutput },
      }).pipe(
        Layer.provide(
          OpenAiClient.layerConfig({
            apiKey,
            apiUrl: Config.succeed(
              Option.getOrElse(options.url, () => "https://api.openai.com/v1"),
            ),
          }),
        ),
      );
  }
};

const suggestFor = Effect.fnUntraced(function* (
  store: Store["Service"],
  model: LanguageModel.LanguageModel,
  name: string,
  issueId: string,
) {
  const found = yield* store.issue(issueId, 20);

  if (Option.isNone(found)) {
    return yield* new IssueNotFound({ issueId });
  }

  const { issue, events } = found.value;

  const response = yield* model.generateText({
    prompt: Prompt.make(JSON.stringify(toState(issue, events), null, 2)).pipe(
      Prompt.setSystem(instructions),
    ),
  });

  yield* store.saveSuggestion({
    issueId: issue.id,
    model: name,
    issueCount: issue.count,
    text: response.text,
  });

  return { issue, model: name, text: response.text };
});
