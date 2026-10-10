import { describe, expect, test } from "bun:test";
import { Effect, Layer, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { Journal } from "./Journal.js";

describe("Journal", () => {
  test("asks journalctl for full fields, so long crash messages are kept", async () => {
    const seen: Array<ChildProcess.Command> = [];

    const spawner = Layer.mock(ChildProcessSpawner.ChildProcessSpawner, {
      streamLines: (command) => {
        seen.push(command);

        return Stream.empty;
      },
    });

    await Effect.gen(function* () {
      const journal = yield* Journal;

      yield* journal
        .read({ after: "s=1;i=2", follow: true })
        .pipe(Stream.runDrain);
    }).pipe(
      Effect.provide(Journal.layer.pipe(Layer.provide(spawner))),
      Effect.runPromise,
    );

    expect(seen).toHaveLength(1);

    const [command] = seen;

    expect(command?._tag).toBe("StandardCommand");

    if (command?._tag !== "StandardCommand") {
      return;
    }

    expect(command.command).toBe("journalctl");
    expect(command.args).toContain("--all");
    expect(command.args).toContain("--output=json");
    expect(command.args).toContain("--after-cursor=s=1;i=2");
    expect(command.args).toContain("--follow");
  });

  test("reads one program at every priority, from every journal mounted", async () => {
    const seen: Array<ChildProcess.Command> = [];

    const spawner = Layer.mock(ChildProcessSpawner.ChildProcessSpawner, {
      streamLines: (command) => {
        seen.push(command);

        return Stream.empty;
      },
    });

    await Effect.gen(function* () {
      const journal = yield* Journal;

      yield* journal
        .read({ follow: false, identifier: "homeassistant", merge: true })
        .pipe(Stream.runDrain);
    }).pipe(
      Effect.provide(Journal.layer.pipe(Layer.provide(spawner))),
      Effect.runPromise,
    );

    const [command] = seen;

    if (command?._tag !== "StandardCommand") {
      throw new Error("Expected a journalctl command");
    }

    expect(command.args).toContain("--merge");
    expect(command.args).toContain("SYSLOG_IDENTIFIER=homeassistant");
    expect(command.args.some((arg) => arg.startsWith("PRIORITY="))).toBe(false);
  });
});
