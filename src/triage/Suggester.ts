import { AnthropicClient, AnthropicLanguageModel } from "@effect/ai-anthropic";
import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai-compat";
import { type Api, Issue } from "@timmo001/effect-triage";
import {
  Config,
  Context,
  type Duration,
  Effect,
  Layer,
  Option,
  Schedule,
  Schema,
} from "effect";
import { LanguageModel, Prompt } from "effect/ai";
import { FetchHttpClient } from "effect/http";
import { IssueNotFound } from "../store/Store.js";
import { clear, toState } from "./Triager.js";
import { revealed } from "./internal.js";
import { Work } from "./Work.js";

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

const instructions = `You help someone fix a crash or error on their own Linux machine, often Arch Linux with the Omarchy Hyprland desktop, or in their Home Assistant. You're given an issue grouped from the system journal, with sample messages, for crashes the top stack frames, and when known the systemd unit, whether it's a system or user unit, the lines it logged just before, and the warnings the same program logged most often, with how many times. Personal details were redacted before you saw them: <user>, <host>, <ip>, <mac>, <uuid>, <id>, <email>, <redacted>, and ~ for the home directory, and in Home Assistant <device>, <entity>, <area>, <floor> and <home>. Some come with a short code, such as <ip:71d0a3c2e94b>: the same code is the same value, and a different one a different value, which you can use to tell whether two messages are about the same device or address.

Reply in Markdown, in under 250 words:
1. The most likely cause, in one or two sentences.
2. Numbered steps to confirm and fix it, with the exact commands to run. For user units, use \`systemctl --user\` and \`journalctl --user-unit\`.

Some issues are Home Assistant Core's own errors, which come with the integration that logged them. For those, the steps happen in Home Assistant rather than with \`systemctl\` or \`journalctl\`: the integration's settings, the device or service it connects to, and its documentation. When the message doesn't say what went wrong, such as an update coordinator's "Unable to retrieve data after 5 consecutive update failures", the cause was only logged at debug level. Say so, and tell them to turn on debug logging for the integration from its page under Settings > Devices & services, or with the \`logger.set_level\` action for \`homeassistant.components.<domain>\`, then wait for it to happen again.

Say when the details aren't enough to be sure, and what to check next. Don't invent package names, options or file paths.`;

/** An event a suggestion was based on. */
export interface Evidence {
  readonly host: string;
  readonly id: string;
  /** When it happened, in milliseconds since the Unix epoch. */
  readonly timestamp: number;
}

export interface Suggestion {
  readonly issue: Issue.Issue;
  /** The model that wrote it, as `provider/model`. */
  readonly model: string;
  readonly text: string;
  /** Every event the model was given, newest first. */
  readonly evidence: ReadonlyArray<Evidence>;
}

/**
 * Asks a language model how to fix an issue, from its stored, redacted
 * events only.
 */
export class Suggester extends Context.Service<
  Suggester,
  {
    /** Suggest a fix for one issue, on request. */
    suggest(
      issueId: string,
    ): Effect.Effect<
      Suggestion,
      Effect.Error<ReturnType<typeof suggestFor>> | IssueNotFound
    >;
    /**
     * Suggest fixes for issues `decisionModel` rated at least `worth` that
     * this model hasn't suggested a fix for yet, most recently seen first,
     * within the daily limit where the suggestions are kept.
     */
    suggestWorth(options: {
      readonly decisionModel: string;
      readonly worth: number;
      readonly limit: number;
    }): Effect.Effect<
      ReadonlyArray<Suggestion>,
      Effect.Error<ReturnType<typeof suggestFor>>
    >;
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
    /**
     * Show the model the values behind redaction tokens this machine keeps,
     * only for a model on this machine or its own network.
     */
    readonly reveal: boolean;
  }) =>
    Layer.effect(
      Suggester,
      Effect.gen(function* () {
        const work = yield* Work;
        const model = yield* LanguageModel.LanguageModel;
        const name = `${options.provider}/${options.model}`;

        return Suggester.of({
          suggest: Effect.fn("Suggester.suggest")(function* (issueId) {
            const found = yield* work.issue(issueId);

            if (Option.isNone(found)) {
              return yield* new IssueNotFound({ issueId });
            }

            return yield* suggestFor(
              work,
              model,
              name,
              found.value,
              options.reveal,
            );
          }),
          suggestWorth: Effect.fn("Suggester.suggestWorth")(
            function* (request) {
              const issues = yield* work.toSuggest({ ...request, model: name });

              return yield* Effect.forEach(issues, (detail) =>
                suggestFor(work, model, name, detail, options.reveal),
              );
            },
          ),
        });
      }),
    ).pipe(
      Layer.provide(
        languageModel(options).pipe(Layer.provide(FetchHttpClient.layer)),
      ),
    );
}

/**
 * Suggest fixes every `interval` for issues `decisionModel` clearly rated
 * worth fixing, up to `limit` a run. A failed run is logged and tried again
 * next time.
 */
export const layerAutomatic = (options: {
  readonly interval: Duration.Input;
  readonly limit: number;
  readonly decisionModel: string;
}) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const suggester = yield* Suggester;

      yield* suggester
        .suggestWorth({
          decisionModel: options.decisionModel,
          worth: clear,
          limit: options.limit,
        })
        .pipe(
          Effect.tap(({ length }) =>
            length === 0
              ? Effect.void
              : Effect.logInfo(
                  `Suggested fixes for ${length} issue${length === 1 ? "" : "s"}`,
                ),
          ),
          Effect.catch((error) =>
            Effect.logWarning(`Couldn't suggest fixes: ${error.message}`),
          ),
          Effect.repeat(Schedule.spaced(options.interval)),
          Effect.forkScoped,
        );
    }),
  );

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

/** The longest breadcrumb line sent, matching the decision models' messages. */
const maxBreadcrumb = 300;

/** How many of the program's most frequent warnings are sent. */
const maxWarnings = 5;

/**
 * The decision models' description of an issue, plus its unit or Home
 * Assistant integration, the lines logged before the latest event that has
 * them, and the warnings its program logged most often.
 */
const describe = ({
  issue,
  events,
  warnings,
}: Pick<Api.IssueDetail, "issue" | "events" | "warnings">) => {
  const state = toState(issue, events);
  const latest = events.find((event) => event.breadcrumbs !== undefined);
  const unit = latest ?? events[0];

  const integration = events.find(
    (event) => event.integration !== undefined,
  )?.integration;

  return {
    issue: {
      ...state.issue,
      ...(unit?.unit !== undefined && { unit: unit.unit }),
      ...(unit?.scope !== undefined && { scope: unit.scope }),
      ...(integration !== undefined && {
        homeAssistantIntegration: integration,
      }),
      ...(latest?.breadcrumbs !== undefined && {
        breadcrumbs: latest.breadcrumbs.map((line) =>
          line.slice(0, maxBreadcrumb),
        ),
      }),
      ...(warnings.length > 0 && {
        warnings: warnings.slice(0, maxWarnings).map((warning) => ({
          message: warning.template.slice(0, maxBreadcrumb),
          count: warning.count,
        })),
      }),
    },
  };
};

const suggestFor = Effect.fnUntraced(function* (
  work: Work["Service"],
  model: LanguageModel.LanguageModel,
  name: string,
  detail: Api.IssueDetail,
  reveal: boolean,
) {
  const { issue, events, warnings } = detail;

  const shown = reveal
    ? { ...(yield* revealed(work, issue, events)), warnings }
    : detail;

  const response = yield* model.generateText({
    prompt: Prompt.make(JSON.stringify(describe(shown), null, 2)).pipe(
      Prompt.setSystem(instructions),
    ),
  });

  const evidence = events.map(({ host, id, timestamp }) => ({
    host,
    id,
    timestamp,
  }));

  yield* work.saveSuggestion({
    issueId: issue.id,
    model: name,
    issueCount: issue.count,
    text: response.text,
    evidence: JSON.stringify(evidence.map(({ host, id }) => ({ host, id }))),
  });

  return { issue, model: name, text: response.text, evidence };
});
