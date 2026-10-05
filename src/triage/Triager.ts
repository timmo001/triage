import {
  CloudflareClient,
  CloudflareDecisionModel,
} from "@effect/ai-cloudflare";
import { TypeSafeClient, TypeSafeDecisionModel } from "@effect/ai-typesafe";
import { Event, Issue } from "@timmo001/effect-triage";
import {
  Config,
  Context,
  type Duration,
  Effect,
  Layer,
  Option,
  Schedule,
  Schema,
  type Types,
} from "effect";
import { Decision, DecisionModel } from "effect/ai";
import { FetchHttpClient } from "effect/http";
import { type LabelledDecision, Store } from "../store/Store.js";

/** How sure a model must be before its answer counts as a clear yes or no. */
const clear = 0.8;

/** How a model's decisions compare with hand labels. */
export interface Agreement {
  readonly model: string;
  /** Labelled issues the model decided on. */
  readonly labelled: number;
  /** Decisions sure enough to act on either way. */
  readonly clear: number;
  /** Clear decisions that match the label. */
  readonly correct: number;
}

/** Summarise each model's decisions against the hand labels. */
export const agreement = (
  rows: ReadonlyArray<LabelledDecision>,
): ReadonlyArray<Agreement> => {
  const byModel = new Map<string, Types.Mutable<Agreement>>();

  for (const row of rows) {
    const summary = byModel.get(row.model) ?? {
      model: row.model,
      labelled: 0,
      clear: 0,
      correct: 0,
    };

    summary.labelled += 1;

    if (row.worth >= clear || row.worth <= 1 - clear) {
      summary.clear += 1;

      if (row.worth >= clear === row.label) {
        summary.correct += 1;
      }
    }

    byModel.set(row.model, summary);
  }

  return [...byModel.values()];
};

/** The longest message sent to the model, so a state fits in about 1k tokens. */
const maxMessage = 300;

/** How many distinct messages and crash frames describe an issue. */
const maxSamples = 3;

const maxFrames = 5;

const State = Schema.Struct({
  issue: Schema.Struct({
    kind: Issue.Kind,
    title: Schema.String,
    events: Schema.Int,
    messages: Schema.Array(Schema.String),
    frames: Schema.optionalKey(Schema.Array(Schema.String)),
  }),
});

const Questions = Decision.make({
  input: State,
  decisions: {
    worth: Decision.probability({
      instructions:
        "`issue` is a real fault worth a developer's time to investigate and fix",
      criteria: {
        false: "Expected, harmless or one-off noise, or caused by the user",
        true: "A real fault that will keep happening until it's fixed",
      },
    }),
    severity: Decision.rate({
      instructions:
        "How much does `issue` affect the person using the machine? none: not noticed; minor: a small annoyance; major: a feature or app stops working; critical: data loss, or the session or machine goes down",
      criteria: ["none", "minor", "major", "critical"],
    }),
    cause: Decision.classify({
      instructions: "What most likely causes `issue`?",
      criteria: {
        application: "A bug in an application or service",
        configuration: "A missing or wrong setting, file or dependency",
        hardware: "Hardware, firmware or a driver",
        user: "Something the user did, such as a wrong password",
        transient: "A temporary network, device or timing problem",
        other: "Anything else",
      },
    }),
  },
});

export interface Decided {
  readonly issue: Issue.Issue;
  readonly answers: Decision.Answers<typeof Questions.decisions>;
}

const frame = (frame: Event.Frame) =>
  [frame.function, frame.module].filter((part) => part !== undefined).join(" ");

/** Describe an issue from its stored, redacted events, never raw journal fields. */
export const toState = (
  issue: Issue.Issue,
  events: ReadonlyArray<Event.Event>,
): typeof State.Type => {
  const messages = [
    ...new Set(events.map((event) => event.message.slice(0, maxMessage))),
  ].slice(0, maxSamples);

  const crash = events.find(Event.Event.guards.Crash);

  const described: Types.Mutable<typeof State.Type.issue> = {
    kind: issue.kind,
    title: issue.title,
    events: issue.count,
    messages,
  };

  if (crash !== undefined) {
    described.frames = crash.frames
      .slice(0, maxFrames)
      .map(frame)
      .filter((line) => line !== "");
  }

  return { issue: described };
};

/**
 * Asks a decision model whether issues are worth fixing, in shadow mode: the
 * answers are only stored, to compare models and hand labels before they
 * drive anything.
 */
export class Triager extends Context.Service<
  Triager,
  {
    /** Decide on issues the model hasn't seen yet, most recently seen first. */
    decide(
      limit: number,
    ): Effect.Effect<
      ReadonlyArray<Decided>,
      Effect.Error<ReturnType<typeof decideAll>>
    >;
  }
>()("triage/triage/Triager") {
  /**
   * Any TypeSafe System One API at `url`, such as Ollaya or Ollama locally,
   * with `$TRIAGE_DECISION_API_KEY` when it needs one, or Clef on Cloudflare
   * Workers AI with `$CLOUDFLARE_ACCOUNT_ID` and `$CLOUDFLARE_API_TOKEN`.
   * Decisions are stored as `provider/model`.
   */
  static readonly layer = (options: {
    readonly provider: Provider;
    readonly url: string;
    readonly model: string;
  }) =>
    Layer.effect(
      Triager,
      Effect.gen(function* () {
        const store = yield* Store;
        const decisions = yield* DecisionModel.DecisionModel;
        const name = `${options.provider}/${options.model}`;

        return Triager.of({
          decide: (limit) => decideAll(store, decisions, name, limit),
        });
      }),
    ).pipe(
      Layer.provide(
        decisionModel(options).pipe(Layer.provide(FetchHttpClient.layer)),
      ),
    );
}

/**
 * Where decisions are made: any TypeSafe System One API, local or hosted, or
 * Clef on Cloudflare.
 */
export const Provider = Schema.Literals(["typesafe", "cloudflare"]);

export type Provider = typeof Provider.Type;

/**
 * Decide on new issues every `interval`, still in shadow mode. A failed run,
 * such as the model being unreachable, is logged and tried again next time.
 */
export const layerShadow = (options: {
  readonly interval: Duration.Input;
  readonly limit: number;
}) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const triager = yield* Triager;

      yield* triager.decide(options.limit).pipe(
        Effect.tap((decided) =>
          decided.length === 0
            ? Effect.void
            : Effect.logInfo(`Decided on ${decided.length} new issues`),
        ),
        Effect.catch((error) =>
          Effect.logWarning(`Couldn't decide on new issues: ${error.message}`),
        ),
        Effect.repeat(Schedule.spaced(options.interval)),
        Effect.forkScoped,
      );
    }),
  );

const decisionModel = (options: {
  readonly provider: Provider;
  readonly url: string;
  readonly model: string;
}) =>
  options.provider === "cloudflare"
    ? CloudflareDecisionModel.layer({ model: options.model }).pipe(
        Layer.provide(CloudflareClient.layerConfig()),
      )
    : TypeSafeDecisionModel.layer({ model: options.model }).pipe(
        Layer.provide(
          TypeSafeClient.layerConfig({
            apiUrl: Config.succeed(options.url),
            apiKey: Config.Redacted("TRIAGE_DECISION_API_KEY").pipe(
              Config.withDefault(undefined),
            ),
          }),
        ),
      );

const decideAll = Effect.fnUntraced(function* (
  store: Store["Service"],
  decisions: DecisionModel.DecisionModel,
  name: string,
  limit: number,
) {
  const issues = yield* store.undecided(name, limit);
  const decided: Array<Decided> = [];

  for (const summary of issues) {
    const found = yield* store.issue(summary.id, 20);

    if (Option.isNone(found)) {
      continue;
    }

    const { issue, events } = found.value;

    const { answers } = yield* decisions.decide(Questions, {
      input: toState(issue, events),
    });

    yield* store.saveDecision({
      issueId: issue.id,
      model: name,
      issueCount: issue.count,
      worth: answers.worth.probability,
      severity: answers.severity.rating,
      cause: answers.cause.label,
      answers: JSON.stringify(answers),
    });

    decided.push({ issue, answers });
  }

  return decided;
});
