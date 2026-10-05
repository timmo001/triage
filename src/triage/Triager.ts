import { TypeSafeClient, TypeSafeDecisionModel } from "@effect/ai-typesafe";
import { Event, Issue } from "@timmo001/effect-triage";
import { Context, Effect, Layer, Option, Schema, type Types } from "effect";
import { Decision, DecisionModel } from "effect/ai";
import { FetchHttpClient } from "effect/http";
import { Store } from "../store/Store.js";

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
const toState = (
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
  /** Ollaya, or another TypeSafe-compatible API, at `url`. */
  static readonly layer = (options: {
    readonly url: string;
    readonly model: string;
  }) =>
    Layer.effect(
      Triager,
      Effect.gen(function* () {
        const store = yield* Store;
        const decisions = yield* DecisionModel.DecisionModel;

        return Triager.of({
          decide: (limit) => decideAll(store, decisions, options.model, limit),
        });
      }),
    ).pipe(
      Layer.provide(TypeSafeDecisionModel.layer({ model: options.model })),
      Layer.provide(TypeSafeClient.layer({ apiUrl: options.url })),
      Layer.provide(FetchHttpClient.layer),
    );
}

const decideAll = Effect.fnUntraced(function* (
  store: Store["Service"],
  decisions: DecisionModel.DecisionModel,
  model: string,
  limit: number,
) {
  const issues = yield* store.undecided(model, limit);
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
      model,
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
