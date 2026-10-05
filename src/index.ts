import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, Effect, Layer } from "effect";
import { Command, Flag } from "effect/cli";
import packageJson from "../package.json" with { type: "json" };
import { Collector } from "./collect/Collector.js";
import { Journal } from "./journal/Journal.js";
import { Redactor } from "./redact.js";
import { Store } from "./store/Store.js";

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

const triage = Command.make("triage").pipe(
  Command.withDescription(
    "Capture crashes and errors from your machines, decide which are worth fixing, and suggest fixes",
  ),
  Command.withSubcommands([collect, issues]),
);

triage.pipe(
  Command.run({ version: packageJson.version }),
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);
