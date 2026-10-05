import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Config, Console, Effect, Layer, Option, Redacted } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import packageJson from "../package.json" with { type: "json" };
import { Collector } from "./collect/Collector.js";
import { Journal } from "./journal/Journal.js";
import { Redactor } from "./redact.js";
import * as Server from "./server/Server.js";
import { TokenName, Tokens } from "./server/Tokens.js";
import { Store, type TokenScope } from "./store/Store.js";
import { agreement, Provider, Triager } from "./triage/Triager.js";
import { Uploader } from "./upload/Uploader.js";

const collectorLayer = Collector.layer.pipe(
  Layer.provide(Layer.mergeAll(Journal.layer, Redactor.layer)),
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
    json,
  },
  Effect.fn(function* (input) {
    const store = yield* Store;
    const list = yield* store.issues({ limit: input.limit });

    if (input.json) {
      yield* Console.log(JSON.stringify(list));

      return;
    }

    for (const issue of list) {
      yield* Console.log(
        `${issue.id}  ${String(issue.count).padStart(6)}  ${new Date(issue.lastSeen).toISOString()}  ${issue.title}`,
      );
    }
  }),
).pipe(
  Command.withDescription("List issues, most recently seen first"),
  Command.provide(Store.layer),
);

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

const decide = Command.make(
  "decide",
  {
    provider: Flag.Literals("provider", Provider.literals).pipe(
      Flag.withDescription(
        "Decide locally through Ollaya, or with Clef on Cloudflare using $CLOUDFLARE_ACCOUNT_ID and $CLOUDFLARE_API_TOKEN",
      ),
      Flag.withFallbackConfig(
        Config.Literals(Provider.literals, "TRIAGE_DECISION_PROVIDER"),
      ),
      Flag.withDefault("ollaya"),
    ),
    url: Flag.String("url").pipe(
      Flag.withDescription("Ollaya's API, or another TypeSafe-compatible one"),
      Flag.withFallbackConfig(Config.String("TRIAGE_DECISION_URL")),
      Flag.withDefault("http://127.0.0.1:11435/v1"),
    ),
    model: Flag.String("model").pipe(
      Flag.withAlias("m"),
      Flag.withDescription(
        "The decision model: laya by default with Ollaya, clef-flash with Cloudflare",
      ),
      Flag.withFallbackConfig(Config.String("TRIAGE_DECISION_MODEL")),
      Flag.optional,
    ),
    limit: Flag.Int("limit").pipe(
      Flag.withAlias("n"),
      Flag.withDescription("The most issues to decide on"),
      Flag.withDefault(20),
    ),
    json,
  },
  Effect.fn(function* (input) {
    const model = Option.getOrElse(input.model, () =>
      input.provider === "cloudflare" ? "clef-flash" : "laya",
    );

    const decided = yield* Effect.gen(function* () {
      const triager = yield* Triager;

      return yield* triager.decide(input.limit);
    }).pipe(Effect.provide(Triager.layer({ ...input, model })));

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
  Command.provide(Store.layerServer),
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
  },
  (input) => Layer.launch(Server.layer(input)),
).pipe(
  Command.withDescription(
    "Run the triage server over HTTP, which collects events from enrolled hosts. Use a reverse proxy or Cloudflare for HTTPS",
  ),
  Command.provide(tokensLayer),
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

  const add = Command.make(
    "add",
    { name },
    Effect.fn(function* (input) {
      const tokens = yield* Tokens;
      const token = yield* tokens.issue(options.scope, input.name);

      yield* Console.log(
        `Added ${input.name}. Set this as ${options.variable}; it won't be shown again:\n${Redacted.value(token)}`,
      );
    }),
  ).pipe(Command.withDescription(`Add ${options.noun} and print its token`));

  const list = Command.make(
    "list",
    { json },
    Effect.fn(function* (input) {
      const tokens = yield* Tokens;
      const all = yield* tokens.list(options.scope);

      if (input.json) {
        yield* Console.log(JSON.stringify(all));

        return;
      }

      for (const token of all) {
        yield* Console.log(
          `${token.name}  ${new Date(token.createdAt).toISOString()}`,
        );
      }
    }),
  ).pipe(Command.withDescription(`List each ${options.noun}, oldest first`));

  const remove = Command.make(
    "remove",
    { name },
    Effect.fn(function* (input) {
      const tokens = yield* Tokens;

      yield* tokens.revoke(options.scope, input.name);
      yield* Console.log(`Removed ${input.name}; its token no longer works`);
    }),
  ).pipe(Command.withDescription(`Remove ${options.noun}, revoking its token`));

  return Command.make(options.command).pipe(
    Command.withDescription(options.description),
    Command.withSubcommands([add, list, remove]),
    Command.provide(tokensLayer),
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
  description: "Manage the admins that can read issues",
  noun: "an admin",
  nameDescription: "A name for the admin, such as aidan",
  variable: "TRIAGE_ADMIN_TOKEN wherever you read issues",
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
    hosts,
    admins,
    decide,
    label,
    agreementCommand,
  ]),
);

triage.pipe(
  Command.run({ version: packageJson.version }),
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);
