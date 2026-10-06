import { describe, expect, test } from "bun:test";
import { Event } from "@timmo001/effect-triage";
import { Effect, Option } from "effect";
import { Store } from "./Store.js";

const log = (id: string, timestamp: number) =>
  Event.Event.cases.LogError.make({
    id,
    host: "omarchy",
    timestamp,
    severity: "err",
    identifier: "bluetoothd",
    message: `connect failed (${id})`,
  });

describe("Store", () => {
  test("stores events once and groups them into issues", async () => {
    const result = await Effect.gen(function* () {
      const store = yield* Store;

      const first = yield* store.record("journal", [log("1", 10)], "c1");

      const second = yield* store.record(
        "journal",
        [log("1", 10), log("2", 30), log("3", 20)],
        "c3",
      );

      return {
        first,
        second,
        cursor: yield* store.cursor("journal"),
        issues: yield* store.issues({ limit: 10 }),
      };
    }).pipe(Effect.provide(Store.layerFile(":memory:")), Effect.runPromise);

    expect(result.first).toBe(1);
    expect(result.second).toBe(2);
    expect(result.cursor).toEqual(Option.some("c3"));
    expect(result.issues).toHaveLength(1);

    expect(result.issues[0]).toMatchObject({
      title: "bluetoothd: connect failed (<n>)",
      firstSeen: 10,
      lastSeen: 30,
      count: 3,
    });
  });

  test("reopens resolved issues as regressed, to decide on again", async () => {
    const result = await Effect.gen(function* () {
      const store = yield* Store;
      const now = Date.now();

      const state = Effect.map(
        store.issues({ limit: 1 }),
        (issues) => issues[0]?.state,
      );

      yield* store.add([log("1", now - 1000)]);

      const [issue] = yield* store.issues({ limit: 1 });
      const id = issue?.id ?? "";
      const fresh = yield* state;

      yield* store.saveDecision({
        issueId: id,
        model: "m",
        issueCount: 1,
        worth: 0.9,
        severity: 1,
        cause: "application",
        answers: "{}",
      });
      const decided = yield* store.undecided("m", 10);

      yield* store.setStatus(id, "resolved");
      yield* store.add([log("2", now - 500)]);
      const late = yield* state;

      yield* store.add([log("3", now + 60_000)]);
      const regressed = yield* state;
      const redecide = yield* store.undecided("m", 10);

      yield* store.setStatus(id, "muted");
      yield* store.add([log("4", now + 120_000)]);
      const muted = yield* state;
      const mutedUndecided = yield* store.undecided("m", 10);

      return {
        fresh,
        decided,
        late,
        regressed,
        redecide,
        muted,
        mutedUndecided,
      };
    }).pipe(Effect.provide(Store.layerFile(":memory:")), Effect.runPromise);

    expect(result.fresh).toBe("new");
    expect(result.decided).toHaveLength(0);
    expect(result.late).toBe("resolved");
    expect(result.regressed).toBe("regressed");
    expect(result.redecide).toHaveLength(1);
    expect(result.muted).toBe("muted");
    expect(result.mutedUndecided).toHaveLength(0);
  });
});
