import { describe, expect, test } from "bun:test";
import { Event, Issue } from "@timmo001/effect-triage";
import { ConfigProvider, Effect, Layer, Option } from "effect";
import {
  FingerprintNotFound,
  IssueNotFound,
  type ListOptions,
  NothingToMerge,
  NothingToUnmerge,
  Store,
} from "./Store.js";

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
  test("keeps one redaction key, and the first value behind each token", async () => {
    const result = await Effect.gen(function* () {
      const store = yield* Store;
      const first = yield* store.redactionKey;
      const second = yield* store.redactionKey;

      yield* store.remember([
        { token: "<ip:0123abcd>", kind: "ip", value: "192.168.1.20" },
      ]);
      yield* store.remember([
        { token: "<ip:0123abcd>", kind: "ip", value: "192.168.1.20" },
      ]);

      return { first, second };
    }).pipe(Effect.provide(Store.layerFile(":memory:")), Effect.runPromise);

    expect(result.first).toHaveLength(32);
    expect(result.second).toEqual(result.first);
  });

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

      yield* store.setStatus(id, "resolved", {
        by: "aidan",
        note: "  Fixed in bluez 5.80, see /home/aidan/notes.md  ",
      });
      yield* store.add([log("2", now - 500)]);
      const late = yield* state;

      yield* store.add([log("3", now + 60_000)]);
      const regressed = yield* state;
      const redecide = yield* store.undecided("m", 10);

      yield* store.setStatus(id, "muted", { by: "cli" });
      yield* store.add([log("4", now + 120_000)]);
      const muted = yield* state;
      const mutedUndecided = yield* store.undecided("m", 10);

      const notes = Option.map(
        yield* store.review(id, 1),
        (review) => review.notes,
      );

      return {
        fresh,
        decided,
        late,
        regressed,
        redecide,
        muted,
        mutedUndecided,
        notes,
      };
    }).pipe(Effect.provide(Store.layerFile(":memory:")), Effect.runPromise);

    expect(result.fresh).toBe("new");
    expect(result.decided).toHaveLength(0);
    expect(result.late).toBe("resolved");
    expect(result.regressed).toBe("regressed");
    expect(result.redecide).toHaveLength(1);
    expect(result.muted).toBe("muted");
    expect(result.mutedUndecided).toHaveLength(0);

    // Newest first: the late event didn't regress it, the next one did.
    expect(
      Option.getOrThrow(result.notes).map(({ by, status, text }) => ({
        by,
        status,
        text,
      })),
    ).toEqual([
      { by: "cli", status: "muted", text: "" },
      { by: "omarchy", status: "regressed", text: "" },
      {
        by: "aidan",
        status: "resolved",
        text: "Fixed in bluez 5.80, see ~/notes.md",
      },
    ]);
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
      yield* store.setStatus(id("dbus"), "resolved", { by: "cli" });
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
        unlabelled: yield* titles({ label: ["none"] }),
        noise: yield* titles({ label: ["noise"] }),
        anyLabel: yield* titles({ label: ["none", "noise"] }),
        resolved: yield* titles({ state: ["resolved", "muted"] }),
        search: yield* titles({ search: "WIRE" }),
        laptop: yield* titles({ host: ["laptop"] }),
        bothHosts: yield* titles({ host: ["laptop", "desktop"] }),
        grouped: yield* titles({ group: "state", order: "asc" }),
        labelled: (yield* store.issues({ limit: 10, label: ["noise"] }))[0]
          ?.label,
        counts: yield* store.issueCounts({}),
        unlabelledCounts: yield* store.issueCounts({ label: ["none"] }),
      };
    }).pipe(Effect.provide(Store.layerFile(":memory:")), Effect.runPromise);

    expect(result.latest).toEqual(["wireplumber", "dbus", "bluetoothd"]);
    expect(result.page).toEqual(["dbus"]);
    expect(result.byTitle).toEqual(["bluetoothd", "dbus", "wireplumber"]);
    expect(result.byWorth[0]).toBe("wireplumber");
    expect(result.unlabelled).toEqual(["wireplumber", "dbus"]);
    expect(result.noise).toEqual(["bluetoothd"]);
    expect(result.anyLabel).toEqual(["wireplumber", "dbus", "bluetoothd"]);
    expect(result.resolved).toEqual(["dbus"]);
    expect(result.search).toEqual(["wireplumber"]);
    expect(result.laptop).toEqual(["wireplumber"]);
    expect(result.bothHosts).toEqual(["wireplumber", "dbus", "bluetoothd"]);
    expect(result.grouped).toEqual(["bluetoothd", "wireplumber", "dbus"]);
    expect(result.labelled).toBe("noise");
    expect(result.counts).toEqual({
      total: 3,
      states: {
        new: 2,
        ongoing: 0,
        quiet: 0,
        regressed: 0,
        resolved: 1,
        muted: 0,
      },
    });
    expect(result.unlabelledCounts.total).toBe(2);
  });

  test("makes issues quiet after 72 hours without events", async () => {
    const day = 24 * 60 * 60 * 1000;

    const result = await Effect.gen(function* () {
      const store = yield* Store;
      const now = Date.now();

      const event = (identifier: string, ago: number) =>
        Event.Event.cases.LogError.make({
          id: `${identifier}-${ago}`,
          host: "desktop",
          source: "journal",
          timestamp: now - ago,
          severity: "err",
          identifier,
          message: "failed",
        });

      yield* store.add([
        event("sshd", 20 * day),
        event("sshd", 4 * day),
        event("cups", 20 * day),
        event("cups", day),
      ]);

      const [quiet] = yield* store.issues({ limit: 10, state: ["quiet"] });

      return {
        quiet: quiet?.title,
        counts: (yield* store.issueCounts({})).states,
        found:
          quiet === undefined
            ? undefined
            : Option.map(
                yield* store.issue(quiet.id, 1),
                (found) => found.issue.state,
              ),
      };
    }).pipe(Effect.provide(Store.layerFile(":memory:")), Effect.runPromise);

    expect(result.quiet).toStartWith("sshd");
    expect(result.counts).toMatchObject({ ongoing: 1, quiet: 1 });
    expect(result.found).toEqual(Option.some("quiet"));
  });

  test("takes the quiet window from TRIAGE_QUIET_HOURS", async () => {
    const day = 24 * 60 * 60 * 1000;

    const counts = await Effect.gen(function* () {
      const store = yield* Store;
      const now = Date.now();

      yield* store.add([
        log("old", now - 20 * day),
        log("recent", now - 2 * day),
      ]);

      return (yield* store.issueCounts({})).states;
    }).pipe(
      Effect.provide(
        Store.layerFile(":memory:").pipe(
          Layer.provide(
            ConfigProvider.layer(
              ConfigProvider.fromEnv({ env: { TRIAGE_QUIET_HOURS: "24" } }),
            ),
          ),
        ),
      ),
      Effect.runPromise,
    );

    expect(counts).toMatchObject({ ongoing: 0, quiet: 2 });
  });

  test("finds other errors from the same program, resolved ones first", async () => {
    const result = await Effect.gen(function* () {
      const store = yield* Store;
      const now = Date.now();

      const event = (host: string, message: string, ago: number) =>
        Event.Event.cases.LogError.make({
          id: `${host}-${message}-${ago}`,
          host,
          source: "journal",
          timestamp: now - ago,
          severity: "err",
          identifier: "bluetoothd",
          message,
        });

      yield* store.add([
        event("laptop", "connect failed", 1000),
        event("desktop", "connect failed", 2000),
        event("desktop", "disconnected", 2000),
        event("server", "timed out", 500),
        Event.Event.cases.LogError.make({
          id: "other",
          host: "laptop",
          source: "journal",
          timestamp: now,
          severity: "err",
          identifier: "wireplumber",
          message: "connect failed",
        }),
      ]);

      const issues = yield* store.issues({ limit: 10 });

      const id = (title: string) =>
        issues.find((issue) => issue.title === `bluetoothd: ${title}`)?.id ??
        "";

      yield* store.setStatus(id("disconnected"), "resolved", { by: "cli" });
      yield* store.saveSuggestion(
        {
          issueId: id("disconnected"),
          model: "m",
          issueCount: 1,
          text: "Restart bluetoothd",
          evidence: "[]",
        },
        "cli",
      );

      return {
        hosts: issues.find((issue) => issue.id === id("connect failed"))?.hosts,
        similar: yield* store.similar(id("connect failed"), 10),
        missing: yield* store.similar("missing", 10),
      };
    }).pipe(Effect.provide(Store.layerFile(":memory:")), Effect.runPromise);

    const similar = Option.getOrThrow(result.similar);

    expect([...(result.hosts ?? [])].sort()).toEqual(["desktop", "laptop"]);
    expect(similar.map((issue) => [issue.title, issue.state])).toEqual([
      ["bluetoothd: disconnected", "resolved"],
      ["bluetoothd: timed out", "new"],
    ]);
    expect(
      similar[0]?.suggestions.map((suggestion) => suggestion.text),
    ).toEqual(["Restart bluetoothd"]);
    expect(result.missing).toEqual(Option.none());
  });

  test("finds other issues on the same host around the same time", async () => {
    const result = await Effect.gen(function* () {
      const store = yield* Store;
      const now = Date.now();

      const event = (host: string, identifier: string, ago: number) =>
        Event.Event.cases.LogError.make({
          id: `${host}-${identifier}-${ago}`,
          host,
          source: "journal",
          timestamp: now - ago,
          severity: "err",
          identifier,
          message: "failed",
        });

      yield* store.add([
        event("server", "app-a", 600_000),
        event("server", "app-a", 0),
        // Within a minute of both app-a errors.
        event("server", "app-b", 590_000),
        event("server", "app-b", 30_000),
        // Within a minute of one.
        event("server", "app-c", 20_000),
        // Too far away, or on another host.
        event("server", "app-d", 300_000),
        event("laptop", "app-e", 0),
      ]);

      const issues = yield* store.issues({ limit: 10 });

      const id =
        issues.find((issue) => issue.title === "app-a: failed")?.id ?? "";

      return Option.getOrThrow(yield* store.review(id, 20)).nearby;
    }).pipe(Effect.provide(Store.layerFile(":memory:")), Effect.runPromise);

    expect(result.map((issue) => [issue.title, issue.near])).toEqual([
      ["app-b: failed", 2],
      ["app-c: failed", 1],
    ]);
  });

  test("merges issues into the one seen first, and redirects the others", async () => {
    const result = await Effect.gen(function* () {
      const store = yield* Store;
      const now = Date.now();

      const failure = (id: string, ago: number) =>
        Event.Event.cases.UnitFailure.make({
          id,
          host: "desktop",
          source: "journal",
          timestamp: now - ago,
          severity: "err",
          unit: "bluetooth.service",
          result: "core-dump",
          message: "failed",
        });

      const crash = (id: string, ago: number, top: string) =>
        Event.Event.cases.Crash.make({
          id,
          host: "desktop",
          source: "journal",
          timestamp: now - ago,
          severity: "crit",
          unit: "bluetooth.service",
          message: "dumped core",
          executable: "/usr/lib/bluetooth/bluetoothd",
          signal: "SIGSEGV",
          frames: [{ function: top }],
        });

      yield* store.add([
        failure("f1", 5000),
        crash("c1", 4000, "a"),
        crash("c2", 3000, "b"),
        crash("c3", 2000, "b"),
      ]);

      const issues = yield* store.issues({ limit: 10 });

      const id = (count: number, kind: string) =>
        issues.find((issue) => issue.count === count && issue.kind === kind)
          ?.id ?? "";

      const unit = id(1, "UnitFailure");
      const crashA = id(1, "Crash");
      const crashB = id(2, "Crash");

      yield* store.setStatus(crashB, "muted", { by: "cli", note: "Noisy" });
      yield* store.label(crashA, true);

      const first = yield* store.merge([crashA, crashB], "cli");
      const second = yield* store.merge([unit, crashB], "cli");

      // Both fingerprints still reach the merged issue, under any of its IDs.
      yield* store.add([crash("c4", 1000, "a"), crash("c5", 500, "b")]);
      yield* store.addNote(crashA, "Still crashing", "cli");

      const review = Option.getOrThrow(yield* store.review(crashB, 10));

      return {
        first,
        second,
        review,
        unit,
        crashA,
        listed: (yield* store.issues({ limit: 10 })).map((issue) => issue.id),
        same: yield* Effect.flip(store.merge([crashA, unit], "cli")),
        missing: yield* Effect.flip(store.merge([unit, "missing"], "cli")),
      };
    }).pipe(Effect.provide(Store.layerFile(":memory:")), Effect.runPromise);

    expect(result.first).toEqual({
      id: result.crashA,
      merged: [expect.any(String)],
    });
    expect(result.second.id).toBe(result.unit);
    expect(result.second.merged).toEqual([result.crashA]);
    expect(result.listed).toEqual([result.unit]);

    expect(result.review.issue).toMatchObject({
      id: result.unit,
      kind: "Crash",
      title: "bluetoothd crashed with SIGSEGV",
      count: 6,
      state: "muted",
    });
    expect(result.review.label).toBe("worth");
    expect(result.review.events.map((event) => event.id)).toEqual([
      "c5",
      "c4",
      "c3",
      "c2",
      "c1",
      "f1",
    ]);
    expect(result.review.notes.map((note) => note.text)).toEqual([
      "Still crashing",
      `Merged ${result.crashA}`,
      `Merged ${result.first.merged[0]}`,
      "Noisy",
    ]);

    expect(result.same).toBeInstanceOf(NothingToMerge);
    expect(result.missing).toEqual(new IssueNotFound({ issueId: "missing" }));
  });

  test("unmerges a fingerprint back into an issue of its own", async () => {
    const crash = (id: string, timestamp: number, top: string) =>
      Event.Event.cases.Crash.make({
        id,
        host: "desktop",
        source: "journal",
        timestamp,
        severity: "crit",
        message: "dumped core",
        executable: "/usr/bin/zsh",
        signal: "SIGSEGV",
        frames: [{ function: top }],
      });

    const a = Issue.fromEvent(crash("a", 0, "a"));
    const b = Issue.fromEvent(crash("b", 0, "b"));

    const result = await Effect.gen(function* () {
      const store = yield* Store;
      const now = Date.now();

      yield* store.add([
        crash("a1", now - 3000, "a"),
        crash("b1", now - 2000, "b"),
        crash("b2", now - 1000, "b"),
      ]);
      yield* store.merge([a.id, b.id], "cli");

      const unmerged = yield* store.unmerge(b.id, b.fingerprint, "cli");

      yield* store.add([crash("b3", now, "b")]);

      const counts = (yield* store.issues({ limit: 10 })).map((issue) => [
        issue.id,
        issue.count,
      ]);

      return {
        unmerged,
        counts,
        notes: Option.map(yield* store.review(b.id, 1), (review) =>
          review.notes.map((note) => note.text),
        ),
        last: yield* Effect.flip(store.unmerge(a.id, a.fingerprint, "cli")),
        other: yield* Effect.flip(store.unmerge(a.id, b.fingerprint, "cli")),
      };
    }).pipe(Effect.provide(Store.layerFile(":memory:")), Effect.runPromise);

    expect(result.unmerged).toBe(b.id);
    expect(result.counts).toEqual([
      [b.id, 3],
      [a.id, 1],
    ]);
    expect(result.notes).toEqual(Option.some([`Unmerged from ${a.id}`]));
    expect(result.last).toBeInstanceOf(NothingToUnmerge);
    expect(result.other).toBeInstanceOf(FingerprintNotFound);
  });

  const warning = (identifier: string, lastSeen: number) => ({
    host: "omarchy",
    bootId: "boot",
    identifier,
    template: "slow reply",
    example: "slow reply",
    count: 1,
    firstSeen: lastSeen,
    lastSeen,
  });

  test("counts warnings and sends only those for programs with an issue", async () => {
    const result = await Effect.gen(function* () {
      const store = yield* Store;
      const now = Date.now();

      yield* store.record("journal", [], "c1", [
        warning("bluetoothd", now - 2000),
        warning("bluetoothd", now - 1000),
        warning("kdeconnectd", now - 1000),
        warning("bluetoothd", now - 8 * 24 * 60 * 60 * 1000),
      ]);

      const beforeIssue = yield* store.pendingWarnings("server", 10);

      yield* store.record("journal", [log("1", now)], "c2");

      const pending = yield* store.pendingWarnings("server", 10);

      yield* store.warningsUploaded("server", pending.versions);

      const sent = yield* store.pendingWarnings("server", 10);

      yield* store.record("journal", [], "c3", [warning("bluetoothd", now)]);

      const changed = yield* store.pendingWarnings("server", 10);
      const [issue] = yield* store.issues({ limit: 1 });

      yield* store.setStatus(issue?.id ?? "", "muted", { by: "cli" });

      const muted = yield* store.pendingWarnings("server", 10);
      const detail = yield* store.issue(issue?.id ?? "", 1);

      return { beforeIssue, pending, sent, changed, muted, detail };
    }).pipe(Effect.provide(Store.layerFile(":memory:")), Effect.runPromise);

    expect(result.beforeIssue.warnings).toEqual([]);
    expect(result.pending.warnings).toMatchObject([
      { identifier: "bluetoothd", count: 2 },
    ]);
    expect(result.sent.warnings).toEqual([]);
    expect(result.changed.warnings).toMatchObject([
      { identifier: "bluetoothd", count: 3 },
    ]);
    expect(result.muted.warnings).toEqual([]);
    expect(Option.map(result.detail, (detail) => detail.warnings)).toEqual(
      Option.some([
        {
          host: "omarchy",
          template: "slow reply",
          example: "slow reply",
          count: 3,
          firstSeen: expect.any(Number),
          lastSeen: expect.any(Number),
        },
      ]),
    );
  });

  test("keeps sent warnings only for programs with an open issue", async () => {
    const result = await Effect.gen(function* () {
      const store = yield* Store;

      yield* store.add([log("1", 10)]);

      const kept = yield* store.addWarnings([
        warning("bluetoothd", 10),
        warning("kdeconnectd", 10),
      ]);

      yield* store.addWarnings([{ ...warning("bluetoothd", 20), count: 5 }]);

      const [issue] = yield* store.issues({ limit: 1 });

      return { kept, detail: yield* store.issue(issue?.id ?? "", 1) };
    }).pipe(Effect.provide(Store.layerFile(":memory:")), Effect.runPromise);

    expect(result.kept).toBe(1);
    expect(Option.map(result.detail, (detail) => detail.warnings)).toEqual(
      Option.some([
        {
          host: "omarchy",
          template: "slow reply",
          example: "slow reply",
          count: 5,
          firstSeen: 20,
          lastSeen: 20,
        },
      ]),
    );
  });
});
