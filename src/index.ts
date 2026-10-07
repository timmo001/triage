import { BunRuntime, BunServices } from "@effect/platform-bun";
import type { Issue } from "@timmo001/effect-triage";
import { Config, Console, Effect, Layer, Option, Redacted } from "effect";
import { Argument, CliError, Command, Flag } from "effect/cli";
import packageJson from "../package.json" with { type: "json" };
import { Attribution } from "./collect/Attribution.js";
import { Collector } from "./collect/Collector.js";
import { Journal } from "./journal/Journal.js";
import { layerOptions } from "./options.js";
import { Redactor } from "./redact.js";
import { IssueAdmin } from "./server/IssueAdmin.js";
import * as Server from "./server/Server.js";
import { TokenAdmin } from "./server/TokenAdmin.js";
import { TokenName, Tokens } from "./server/Tokens.js";
import { Store, type TokenScope } from "./store/Store.js";
import { layerAutomatic, LlmProvider, Suggester } from "./triage/Suggester.js";
import { agreement, layerShadow, Provider, Triager } from "./triage/Triager.js";
import { Work } from "./triage/Work.js";
import { Uploader } from "./upload/Uploader.js";

const collectorLayer = Collector.layer.pipe(
  Layer.provide(
    Layer.mergeAll(Journal.layer, Attribution.layer).pipe(
      Layer.provideMerge(Redactor.layer),
    ),
  ),
  Layer.provideMerge(Store.layer),
);

const json = Flag.Boolean("json").pipe(
  Flag.withDescription("Print JSON"),
  Flag.withDefault(false),
);

interface CollectInput {
  readonly follow: boolean;
  readonly json: boolean;
}

const runCollect = Effect.fn(function* (
  input: CollectInput,
  afterBatch: Effect.Effect<void>,
) {
  const collector = yield* Collector;

  const result = yield* collector.collect({
    follow: input.follow,
    onBatch: (totals) =>
      Effect.andThen(
        input.follow
          ? Effect.logInfo("Collected", totals.added, "new events")
          : Effect.void,
        afterBatch,
      ),
  });

  yield* Console.log(
    input.json
      ? JSON.stringify(result)
      : `Read ${result.entries} journal entries, ${result.added} new events`,
  );
});

const collect = Command.make(
  "collect",
  {
    follow: Flag.Boolean("follow").pipe(
      Flag.withAlias("f"),
      Flag.withDescription("Keep collecting new entries as they're written"),
      Flag.withDefault(false),
    ),
    upload: Flag.Boolean("upload").pipe(
      Flag.withAlias("u"),
      Flag.withDescription(
        "Send new events to $TRIAGE_SERVER after each batch, keeping them to retry when it can't be reached",
      ),
      Flag.withDefault(false),
    ),
    json,
  },
  Effect.fn(function* (input) {
    if (!input.upload) {
      return yield* runCollect(input, Effect.void);
    }

    return yield* Effect.gen(function* () {
      const uploader = yield* Uploader;

      const upload = uploader.upload.pipe(
        Effect.tap((result) =>
          result.sent > 0
            ? Effect.logInfo("Uploaded", result.sent, "events")
            : Effect.void,
        ),
        Effect.catch((error) =>
          Effect.logWarning(
            `Upload failed, retrying after the next batch: ${error.message}`,
          ),
        ),
        Effect.asVoid,
      );

      yield* upload;

      yield* runCollect(input, upload);
    }).pipe(Effect.provide(Uploader.layer));
  }),
).pipe(
  Command.withDescription(
    "Collect crashes, failures and errors from this machine's journal since the last run",
  ),
  Command.provide(collectorLayer),
);

const issues = Command.make(
  "issues",
  {
    limit: Flag.Int("limit").pipe(
      Flag.withAlias("n"),
      Flag.withDescription("The most issues to show"),
      Flag.withDefault(20),
    ),
    server: Flag.Boolean("server").pipe(
      Flag.withDescription(
        "List the server's issues from $TRIAGE_SERVER_DB, for decide, label and suggest",
      ),
      Flag.withDefault(false),
    ),
    json,
  },
  Effect.fn(function* (input) {
    const list = yield* Effect.gen(function* () {
      const store = yield* Store;

      return yield* store.issues({ limit: input.limit });
    }).pipe(Effect.provide(input.server ? Store.layerServer : Store.layer));

    if (input.json) {
      yield* Console.log(JSON.stringify(list));

      return;
    }

    for (const issue of list) {
      yield* Console.log(
        `${issue.id}  ${issue.state.padEnd(9)}  ${String(issue.count).padStart(6)}  ${new Date(issue.lastSeen).toISOString()}  ${issue.title}`,
      );
    }
  }),
).pipe(Command.withDescription("List issues, most recently seen first"));

const upload = Command.make(
  "upload",
  { json },
  Effect.fn(function* (input) {
    const uploader = yield* Uploader;
    const result = yield* uploader.upload;

    yield* Console.log(
      input.json
        ? JSON.stringify(result)
        : `Sent ${result.sent} events, ${result.added} new to the server`,
    );
  }),
).pipe(
  Command.withDescription(
    "Send collected events to the server at $TRIAGE_SERVER, authenticating with $TRIAGE_TOKEN",
  ),
  Command.provide(Uploader.layer.pipe(Layer.provide(Store.layer))),
);

const tokensLayer = Tokens.layer.pipe(Layer.provideMerge(Store.layerServer));

const decisionFlags = {
  provider: Flag.Literals("provider", Provider.literals).pipe(
    Flag.withDescription(
      "Decide through any TypeSafe System One API, such as Ollaya or Ollama locally, or with Clef on Cloudflare using $CLOUDFLARE_ACCOUNT_ID and $CLOUDFLARE_API_TOKEN",
    ),
    Flag.withFallbackConfig(
      Config.Literals(Provider.literals, "TRIAGE_DECISION_PROVIDER"),
    ),
    Flag.withDefault("typesafe"),
  ),
  url: Flag.String("url").pipe(
    Flag.withDescription(
      "The System One API: Ollaya by default, Ollama at http://127.0.0.1:11434/v1, or a hosted one with $TRIAGE_DECISION_API_KEY",
    ),
    Flag.withFallbackConfig(Config.String("TRIAGE_DECISION_URL")),
    Flag.withDefault("http://127.0.0.1:11435/v1"),
  ),
  model: Flag.String("model").pipe(
    Flag.withAlias("m"),
    Flag.withDescription(
      "The decision model: laya by default through System One, clef-flash with Cloudflare",
    ),
    Flag.withFallbackConfig(Config.String("TRIAGE_DECISION_MODEL")),
    Flag.optional,
  ),
};

/** The decision model, or the provider's default when none is set. */
const decisionModel = (input: {
  readonly provider: Provider;
  readonly model: Option.Option<string>;
}) =>
  Option.getOrElse(input.model, () =>
    input.provider === "cloudflare" ? "clef-flash" : "laya",
  );

const triagerLayer = (input: {
  readonly provider: Provider;
  readonly url: string;
  readonly model: Option.Option<string>;
}) =>
  Triager.layer({
    provider: input.provider,
    url: input.url,
    model: decisionModel(input),
  });

const decide = Command.make(
  "decide",
  {
    ...decisionFlags,
    limit: Flag.Int("limit").pipe(
      Flag.withAlias("n"),
      Flag.withDescription("The most issues to decide on"),
      Flag.withDefault(20),
    ),
    json,
  },
  Effect.fn(function* (input) {
    const decided = yield* Effect.gen(function* () {
      const triager = yield* Triager;

      return yield* triager.decide(input.limit);
    }).pipe(Effect.provide(triagerLayer(input)));

    if (input.json) {
      yield* Console.log(JSON.stringify(decided));

      return;
    }

    for (const { issue, answers } of decided) {
      yield* Console.log(
        `${issue.id}  worth ${answers.worth.probability.toFixed(2)}  ${answers.severity.label.padEnd(8)}  ${answers.cause.label.padEnd(13)}  ${issue.title}`,
      );
    }
  }),
).pipe(
  Command.withDescription(
    "Ask a decision model whether the server's new issues are worth fixing, storing the answers without acting on them",
  ),
  Command.provide(
    Work.layerStore({ by: "cli" }).pipe(Layer.provide(Store.layerServer)),
  ),
);

const llmProviderFlag = (name: string, urlFlag: string) =>
  Flag.Literals(name, LlmProvider.literals).pipe(
    Flag.withDescription(
      `Any OpenAI-compatible or Anthropic-compatible API at --${urlFlag}, or Workers AI with $CLOUDFLARE_ACCOUNT_ID and $CLOUDFLARE_API_TOKEN`,
    ),
    Flag.withFallbackConfig(
      Config.Literals(LlmProvider.literals, "TRIAGE_LLM_PROVIDER"),
    ),
    Flag.withDefault("openai"),
  );

const llmUrlFlag = (name: string) =>
  Flag.String(name).pipe(
    Flag.withDescription(
      "The API, such as https://openrouter.ai/api/v1 or https://opencode.ai/zen/v1, with $TRIAGE_LLM_API_KEY when it needs one. Defaults to OpenAI's or Anthropic's own",
    ),
    Flag.withFallbackConfig(Config.String("TRIAGE_LLM_URL")),
    Flag.optional,
  );

const llmModelFlag = (name: string) =>
  Flag.String(name).pipe(
    Flag.withDescription(
      "The language model, such as @cf/zai-org/glm-4.7-flash on Workers AI",
    ),
    Flag.withFallbackConfig(Config.String("TRIAGE_LLM_MODEL")),
  );

const suggest = Command.make(
  "suggest",
  {
    issues: Argument.String("issue").pipe(
      Argument.withDescription("The IDs of the issues to suggest fixes for"),
      Argument.atLeast(1),
    ),
    provider: llmProviderFlag("provider", "url"),
    url: llmUrlFlag("url"),
    model: llmModelFlag("model").pipe(Flag.withAlias("m")),
    json,
  },
  Effect.fn(function* (input) {
    const suggestions = yield* Effect.gen(function* () {
      const suggester = yield* Suggester;

      return yield* Effect.forEach(input.issues, (issue) =>
        suggester.suggest(issue),
      );
    }).pipe(Effect.provide(Suggester.layer(input)));

    if (input.json) {
      yield* Console.log(JSON.stringify(suggestions));

      return;
    }

    for (const { issue, text, evidence } of suggestions) {
      const hosts = [...new Set(evidence.map((event) => event.host))];
      const times = evidence.map((event) => event.timestamp);

      yield* Console.log(
        `## ${issue.id}  ${issue.title}\n\n${text}\n\nBased on ${evidence.length} of ${issue.count} events from ${hosts.join(", ")}, ${new Date(Math.min(...times)).toISOString()} to ${new Date(Math.max(...times)).toISOString()}\n`,
      );
    }
  }),
).pipe(
  Command.withDescription(
    "Ask a language model how to fix some of the server's issues, from their redacted events only, and store its suggestions",
  ),
  Command.provide(
    Work.layerStore({ by: "cli" }).pipe(Layer.provide(Store.layerServer)),
  ),
);

const label = Command.make(
  "label",
  {
    issue: Argument.String("issue").pipe(
      Argument.withDescription("The issue's ID"),
    ),
    verdict: Argument.Literals("verdict", ["worth", "noise"]).pipe(
      Argument.withDescription(
        "worth: a real fault worth fixing; noise: expected, harmless or caused by the user",
      ),
    ),
  },
  Effect.fn(function* (input) {
    const store = yield* Store;

    yield* store.label(input.issue, input.verdict === "worth");
    yield* Console.log(`Labelled ${input.issue} as ${input.verdict}`);
  }),
).pipe(
  Command.withDescription(
    "Label one of the server's issues by hand, to measure decision models against",
  ),
  Command.provide(Store.layerServer),
);

const statusCommand = (options: {
  readonly command: string;
  readonly status: Issue.Status;
  readonly done: string;
  readonly description: string;
}) =>
  Command.make(
    options.command,
    {
      issues: Argument.String("issue").pipe(
        Argument.withDescription("The IDs of the issues"),
        Argument.atLeast(1),
      ),
      server: Flag.String("server").pipe(
        Flag.withDescription(
          "Change the issues on the server at this URL, or $TRIAGE_SERVER, as the admin in $TRIAGE_ADMIN_TOKEN, instead of the server database on this machine",
        ),
        Flag.withFallbackConfig(Config.String("TRIAGE_SERVER")),
        Flag.optional,
      ),
    },
    Effect.fn(function* (input) {
      const setStatuses = Effect.gen(function* () {
        const admin = yield* IssueAdmin;

        for (const id of input.issues) {
          yield* admin.setStatus(id, options.status);
          yield* Console.log(`${options.done} ${id}`);
        }
      });

      yield* Option.match(input.server, {
        onNone: () =>
          setStatuses.pipe(
            Effect.provide(
              IssueAdmin.layerLocal.pipe(Layer.provide(Store.layerServer)),
            ),
          ),
        onSome: (url) =>
          setStatuses.pipe(Effect.provide(IssueAdmin.layerRemote(url))),
      });
    }),
  ).pipe(Command.withDescription(options.description));

const resolve = statusCommand({
  command: "resolve",
  status: "resolved",
  done: "Resolved",
  description:
    "Resolve issues once they're fixed. One that happens again opens as regressed, and is decided on again",
});

const mute = statusCommand({
  command: "mute",
  status: "muted",
  done: "Muted",
  description:
    "Mute issues, so they're never decided on or suggested fixes for, however often they happen",
});

const reopen = statusCommand({
  command: "reopen",
  status: "open",
  done: "Reopened",
  description: "Reopen resolved or muted issues",
});

const agreementCommand = Command.make(
  "agreement",
  { json },
  Effect.fn(function* (input) {
    const store = yield* Store;
    const summaries = agreement(yield* store.labelledDecisions);

    if (input.json) {
      yield* Console.log(JSON.stringify(summaries));

      return;
    }

    for (const summary of summaries) {
      yield* Console.log(
        `${summary.model.padEnd(24)}  ${summary.labelled} labelled  ${summary.clear} clear  ${summary.correct} correct`,
      );
    }
  }),
).pipe(
  Command.withDescription(
    "Compare each decision model with the hand labels: how often it's sure enough to act on, and how often it's right when it is",
  ),
  Command.provide(Store.layerServer),
);

/** Whether and how this device decides on issues and suggests fixes. */
const processFlags = {
  decide: Flag.Boolean("decide").pipe(
    Flag.withDescription(
      "Ask a decision model about new issues every few minutes, keeping the answers without acting on them. Off unless set",
    ),
    Flag.withFallbackConfig(Config.Boolean("TRIAGE_DECIDE")),
    Flag.withDefault(false),
  ),
  ...decisionFlags,
  suggest: Flag.Boolean("suggest").pipe(
    Flag.withDescription(
      "Ask a language model every 15 minutes how to fix issues the decision model clearly rates worth fixing, keeping its suggestions. Off unless set",
    ),
    Flag.withFallbackConfig(Config.Boolean("TRIAGE_SUGGEST")),
    Flag.withDefault(false),
  ),
  llmProvider: llmProviderFlag("llm-provider", "llm-url"),
  llmUrl: llmUrlFlag("llm-url"),
  llmModel: llmModelFlag("llm-model").pipe(Flag.optional),
};

/** The decide and suggest loops `input` turns on, for whichever `Work`. */
const processLoops = Effect.fnUntraced(function* (input: {
  readonly decide: boolean;
  readonly provider: Provider;
  readonly url: string;
  readonly model: Option.Option<string>;
  readonly suggest: boolean;
  readonly llmProvider: LlmProvider;
  readonly llmUrl: Option.Option<string>;
  readonly llmModel: Option.Option<string>;
}) {
  const decider = input.decide
    ? layerShadow({ interval: "5 minutes", limit: 20 }).pipe(
        Layer.provide(triagerLayer(input)),
      )
    : Layer.empty;

  const suggester = input.suggest
    ? layerAutomatic({
        interval: "15 minutes",
        limit: 5,
        decisionModel: `${input.provider}/${decisionModel(input)}`,
      }).pipe(
        Layer.provide(
          Suggester.layer({
            provider: input.llmProvider,
            url: input.llmUrl,
            model: yield* Effect.fromOption(input.llmModel).pipe(
              Effect.mapError(
                () => new CliError.MissingOption({ option: "llm-model" }),
              ),
            ),
          }),
        ),
      )
    : Layer.empty;

  return Layer.mergeAll(decider, suggester);
});

const serve = Command.make(
  "serve",
  {
    hostname: Flag.String("hostname").pipe(
      Flag.withDescription("The address to listen on"),
      Flag.withFallbackConfig(Config.String("TRIAGE_HOSTNAME")),
      Flag.withDefault("127.0.0.1"),
    ),
    port: Flag.Int("port").pipe(
      Flag.withAlias("p"),
      Flag.withDescription("The port to listen on"),
      Flag.withFallbackConfig(Config.Int("TRIAGE_PORT")),
      Flag.withDefault(7171),
    ),
    trustProxy: Flag.Boolean("trust-proxy").pipe(
      Flag.withDescription(
        "Trust X-Forwarded-Host and X-Forwarded-For from a reverse proxy; only when the proxy is the sole way in",
      ),
      Flag.withFallbackConfig(Config.Boolean("TRIAGE_TRUST_PROXY")),
      Flag.withDefault(false),
    ),
    ingressPort: Flag.Int("ingress-port").pipe(
      Flag.withDescription(
        "A second port for Home Assistant ingress, which only answers --ingress-from and needs no admin token",
      ),
      Flag.withFallbackConfig(Config.Int("TRIAGE_INGRESS_PORT")),
      Flag.optional,
    ),
    ingressFrom: Flag.String("ingress-from").pipe(
      Flag.withDescription(
        "The only address the ingress port answers, Home Assistant's Supervisor",
      ),
      Flag.withFallbackConfig(Config.String("TRIAGE_INGRESS_FROM")),
      Flag.withDefault("172.30.32.2"),
    ),
    decideDaily: Flag.Int("decide-daily").pipe(
      Flag.withDescription(
        "The most issues each decision model may decide on in any 24 hours, here with --decide or by workers",
      ),
      Flag.withFallbackConfig(Config.Int("TRIAGE_DECIDE_DAILY")),
      Flag.withDefault(100),
    ),
    suggestDaily: Flag.Int("suggest-daily").pipe(
      Flag.withDescription(
        "The most suggestions each language model may make in any 24 hours, here with --suggest or by workers",
      ),
      Flag.withFallbackConfig(Config.Int("TRIAGE_SUGGEST_DAILY")),
      Flag.withDefault(5),
    ),
    ...processFlags,
  },
  Effect.fnUntraced(function* (input) {
    return yield* Layer.launch(
      Layer.merge(Server.layer(input), yield* processLoops(input)).pipe(
        Layer.provide(
          Work.layerStore({
            by: "server",
            decideDaily: input.decideDaily,
            suggestDaily: input.suggestDaily,
          }),
        ),
      ),
    );
  }),
).pipe(
  Command.withDescription(
    "Run the triage server over HTTP, which collects events from enrolled hosts. Use a reverse proxy or Cloudflare for HTTPS",
  ),
  Command.provide(tokensLayer),
);

const work = Command.make(
  "work",
  processFlags,
  Effect.fnUntraced(function* (input) {
    if (!input.decide && !input.suggest) {
      return yield* new CliError.MissingOption({ option: "decide" });
    }

    return yield* Layer.launch(
      (yield* processLoops(input)).pipe(Layer.provide(Work.layerRemote)),
    );
  }),
).pipe(
  Command.withDescription(
    "Decide on issues and suggest fixes for the server at $TRIAGE_SERVER, authenticating with $TRIAGE_WORKER_TOKEN, within the server's daily limits. Needs --decide, --suggest or both",
  ),
);

const tokenCommands = (options: {
  readonly scope: TokenScope;
  readonly command: string;
  readonly description: string;
  readonly noun: string;
  readonly nameDescription: string;
  readonly variable: string;
}) => {
  const name = Argument.String("name").pipe(
    Argument.withDescription(options.nameDescription),
    Argument.withSchema(TokenName),
  );

  const server = Flag.String("server").pipe(
    Flag.withDescription(
      "Manage the server at this URL, or $TRIAGE_SERVER, as the admin in $TRIAGE_ADMIN_TOKEN, instead of the server database on this machine",
    ),
    Flag.withFallbackConfig(Config.String("TRIAGE_SERVER")),
    Flag.optional,
  );

  const withTokenAdmin = <A, E, R>(
    url: Option.Option<string>,
    effect: Effect.Effect<A, E, R>,
  ) =>
    Option.match(url, {
      onNone: () =>
        effect.pipe(
          Effect.provide(
            TokenAdmin.layerLocal.pipe(Layer.provide(tokensLayer)),
          ),
        ),
      onSome: (url) => effect.pipe(Effect.provide(TokenAdmin.layerRemote(url))),
    });

  const add = Command.make(
    "add",
    { name, server },
    Effect.fn(function* (input) {
      const token = yield* withTokenAdmin(
        input.server,
        Effect.gen(function* () {
          const tokens = yield* TokenAdmin;

          return yield* tokens.issue(options.scope, input.name);
        }),
      );

      yield* Console.log(
        `Added ${input.name}. Set this as ${options.variable}; it won't be shown again:\n${Redacted.value(token)}`,
      );
    }),
  ).pipe(Command.withDescription(`Add ${options.noun} and print its token`));

  const list = Command.make(
    "list",
    { json, server },
    Effect.fn(function* (input) {
      const all = yield* withTokenAdmin(
        input.server,
        Effect.gen(function* () {
          const tokens = yield* TokenAdmin;

          return yield* tokens.list(options.scope);
        }),
      );

      if (input.json) {
        yield* Console.log(JSON.stringify(all));

        return;
      }

      if (all.length === 0) {
        yield* Console.log(
          Option.match(input.server, {
            onNone: () =>
              `No ${options.command} in this machine's server database. To list a server's, add --server <url> or set TRIAGE_SERVER.`,
            onSome: () =>
              `No ${options.command} yet. Add one with triage ${options.command} add <name>.`,
          }),
        );

        return;
      }

      for (const token of all) {
        yield* Console.log(
          `${token.name}  ${new Date(token.createdAt).toISOString()}`,
        );
      }
    }),
  ).pipe(Command.withDescription(`List the ${options.command}, oldest first`));

  const remove = Command.make(
    "remove",
    { name, server },
    Effect.fn(function* (input) {
      yield* withTokenAdmin(
        input.server,
        Effect.gen(function* () {
          const tokens = yield* TokenAdmin;

          yield* tokens.revoke(options.scope, input.name);
        }),
      );

      yield* Console.log(`Removed ${input.name}; its token no longer works`);
    }),
  ).pipe(Command.withDescription(`Remove ${options.noun}, revoking its token`));

  return Command.make(options.command).pipe(
    Command.withDescription(options.description),
    Command.withSubcommands([add, list, remove]),
  );
};

const hosts = tokenCommands({
  scope: "host",
  command: "hosts",
  description: "Manage the hosts that can send events",
  noun: "a host",
  nameDescription:
    "A name for the host that doesn't identify the machine, such as desktop",
  variable: "TRIAGE_TOKEN on the host",
});

const admins = tokenCommands({
  scope: "admin",
  command: "admins",
  description: "Manage the admins that can read issues and manage tokens",
  noun: "an admin",
  nameDescription: "A name for the admin, such as aidan",
  variable: "TRIAGE_ADMIN_TOKEN wherever you read issues",
});

const workers = tokenCommands({
  scope: "worker",
  command: "workers",
  description:
    "Manage the workers that can decide on issues and suggest fixes for this server",
  noun: "a worker",
  nameDescription:
    "A name for the worker that doesn't identify the machine, such as desktop",
  variable: "TRIAGE_WORKER_TOKEN on the worker",
});

const triage = Command.make("triage").pipe(
  Command.withDescription(
    "Capture crashes and errors from your machines, decide which are worth fixing, and suggest fixes",
  ),
  Command.withSubcommands([
    collect,
    issues,
    upload,
    serve,
    work,
    hosts,
    admins,
    workers,
    decide,
    suggest,
    label,
    resolve,
    mute,
    reopen,
    agreementCommand,
  ]),
);

triage.pipe(
  Command.run({ version: packageJson.version }),
  Effect.provide(
    Layer.mergeAll(
      BunServices.layer,
      layerOptions.pipe(Layer.provide(BunServices.layer)),
    ),
  ),
  BunRuntime.runMain,
);
