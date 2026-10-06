import { describe, expect, test } from "bun:test";
import { Event } from "@timmo001/effect-triage";
import { Effect, Option } from "effect";
import { type ListOptions, Store } from "./Store.js";

const log = (id: string, timestamp: number) =>
  Event.Event.cases.LogError.make({
    id,
    host: "omarchy",
    source: "journal",
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

      yield* store.saveDecision(
        {
          issueId: id,
          model: "m",
          issueCount: 1,
          worth: 0.9,
          severity: 1,
          cause: "application",
          answers: "{}",
        },
        "cli",
      );
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

  test("filters, sorts, groups and pages issues, and counts them", async () => {
    const result = await Effect.gen(function* () {
      const store = yield* Store;
      const now = Date.now();

      const event = (identifier: string, host: string, ago: number) =>
        Event.Event.cases.LogError.make({
          id: `${identifier}-${ago}`,
          host,
          source: "journal",
          timestamp: now - ago,
          severity: "err",
          identifier,
          message: "failed",
        });

      yield* store.add([
        event("bluetoothd", "desktop", 3000),
        event("wireplumber", "laptop", 1000),
        event("wireplumber", "laptop", 1500),
        event("dbus", "desktop", 2000),
      ]);

      const all = yield* store.issues({ limit: 10 });

      const id = (name: string) =>
        all.find((issue) => issue.title.startsWith(name))?.id ?? "";

      yield* store.label(id("bluetoothd"), false);
      yield* store.setStatus(id("dbus"), "resolved");
      yield* store.saveDecision(
        {
          issueId: id("wireplumber"),
          model: "m",
          issueCount: 2,
          worth: 0.9,
          severity: 1,
          cause: "application",
          answers: "{}",
        },
        "cli",
      );

      const titles = (options: Partial<ListOptions>) =>
        Effect.map(store.issues({ limit: 10, ...options }), (issues) =>
          issues.map((issue) => issue.title.split(":")[0]),
        );

      return {
        latest: yield* titles({}),
        page: yield* titles({ offset: 1, limit: 1 }),
        byTitle: yield* titles({ sort: "title", order: "asc" }),
        byWorth: yield* titles({ sort: "worth" }),
        unlabelled: yield* titles({ label: "none" }),
        noise: yield* titles({ label: "noise" }),
        resolved: yield* titles({ state: "resolved" }),
        search: yield* titles({ search: "WIRE" }),
        laptop: yield* titles({ host: "laptop" }),
        grouped: yield* titles({ group: "state", order: "asc" }),
        labelled: (yield* store.issues({ limit: 10, label: "noise" }))[0]
          ?.label,
        counts: yield* store.issueCounts({}),
        unlabelledCounts: yield* store.issueCounts({ label: "none" }),
      };
    }).pipe(Effect.provide(Store.layerFile(":memory:")), Effect.runPromise);

    expect(result.latest).toEqual(["wireplumber", "dbus", "bluetoothd"]);
    expect(result.page).toEqual(["dbus"]);
    expect(result.byTitle).toEqual(["bluetoothd", "dbus", "wireplumber"]);
    expect(result.byWorth[0]).toBe("wireplumber");
    expect(result.unlabelled).toEqual(["wireplumber", "dbus"]);
    expect(result.noise).toEqual(["bluetoothd"]);
    expect(result.resolved).toEqual(["dbus"]);
    expect(result.search).toEqual(["wireplumber"]);
    expect(result.laptop).toEqual(["wireplumber"]);
    expect(result.grouped).toEqual(["bluetoothd", "wireplumber", "dbus"]);
    expect(result.labelled).toBe("noise");
    expect(result.counts).toEqual({
      total: 3,
      states: { new: 2, ongoing: 0, regressed: 0, resolved: 1, muted: 0 },
    });
    expect(result.unlabelledCounts.total).toBe(2);
  });
});
