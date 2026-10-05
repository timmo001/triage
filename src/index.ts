import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Config, Console, Effect, Layer, Redacted } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import packageJson from "../package.json" with { type: "json" };
import { Collector } from "./collect/Collector.js";
import { Journal } from "./journal/Journal.js";
import { Redactor } from "./redact.js";
import { HostName, Hosts } from "./server/Hosts.js";
import * as Server from "./server/Server.js";
import { Store } from "./store/Store.js";
import { Uploader } from "./upload/Uploader.js";

const collectorLayer = Collector.layer.pipe(
  Layer.provide(Layer.mergeAll(Journal.layer, Redactor.layer, Store.layer)),
);

const json = Flag.Boolean("json").pipe(
  Flag.withDescription("Print JSON"),
  Flag.withDefault(false),
);

const collect = Command.make(
  "collect",
  {
    follow: Flag.Boolean("follow").pipe(
      Flag.withAlias("f"),
      Flag.withDescription("Keep collecting new entries as they're written"),
      Flag.withDefault(false),
    ),
    json,
  },
  Effect.fn(function* (input) {
    const collector = yield* Collector;

    const result = yield* collector.collect({
      follow: input.follow,
      ...(input.follow && {
        onBatch: (totals) =>
          Effect.logInfo("Collected", totals.added, "new events"),
      }),
    });

    yield* Console.log(
      input.json
        ? JSON.stringify(result)
        : `Read ${result.entries} journal entries, ${result.added} new events`,
    );
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
  },
  Effect.fn(function* (input) {
    yield* Effect.logInfo(
      `Serving triage on http://${input.hostname}:${input.port}`,
    );

    return yield* Layer.launch(Server.layer(input));
  }),
).pipe(
  Command.withDescription(
    "Run the triage server, which collects events from enrolled hosts",
  ),
  Command.provide(Hosts.layer.pipe(Layer.provideMerge(Store.layerServer))),
);

const addHost = Command.make(
  "add",
  {
    name: Argument.String("name").pipe(
      Argument.withDescription(
        "A name for the host that doesn't identify the machine, such as desktop",
      ),
      Argument.withSchema(HostName),
    ),
  },
  Effect.fn(function* (input) {
    const hosts = yield* Hosts;
    const token = yield* hosts.enrol(input.name);

    yield* Console.log(
      `Enrolled ${input.name}. Set this on the host as TRIAGE_TOKEN; it won't be shown again:\n${Redacted.value(token)}`,
    );
  }),
).pipe(
  Command.withDescription("Enrol a host with this server"),
  Command.provide(Hosts.layer.pipe(Layer.provide(Store.layerServer))),
);

const hosts = Command.make("hosts").pipe(
  Command.withDescription("Manage the hosts that can send events"),
  Command.withSubcommands([addHost]),
);

const triage = Command.make("triage").pipe(
  Command.withDescription(
    "Capture crashes and errors from your machines, decide which are worth fixing, and suggest fixes",
  ),
  Command.withSubcommands([collect, issues, upload, serve, hosts]),
);

triage.pipe(
  Command.run({ version: packageJson.version }),
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);
