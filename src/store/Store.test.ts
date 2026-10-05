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
});
