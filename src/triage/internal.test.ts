import { describe, expect, test } from "bun:test";
import { Event, Issue } from "@timmo001/effect-triage";
import { Effect } from "effect";
import { isInternalUrl, revealed } from "./internal.js";
import type { Work } from "./Work.js";

describe("isInternalUrl", () => {
  test.each([
    "http://127.0.0.1:11434/v1",
    "http://localhost:11435/v1",
    "http://[::1]:11434/v1",
    "http://10.0.0.5:11434/v1",
    "http://172.20.1.2/v1",
    "http://192.168.1.20:11434/v1",
    "http://169.254.10.1/v1",
    "http://[fd00::5]:11434/v1",
    "http://[fe80::1]/v1",
    "http://ollama:11434/v1",
    "http://nas.local:11434/v1",
    "http://gpu.lan/v1",
    "http://box.home.arpa/v1",
    "http://ollama.internal/v1",
    "https://ollama.triage.localhost/v1",
  ])("%s is internal", (url) => {
    expect(isInternalUrl(url)).toBe(true);
  });

  test.each([
    "https://api.openai.com/v1",
    "https://api.anthropic.com",
    "https://openrouter.ai/api/v1",
    "http://8.8.8.8/v1",
    "http://172.32.0.1/v1",
    "http://192.169.1.1/v1",
    "http://[2001:db8::1]/v1",
    "http://local.example.com/v1",
    "not a url",
    "",
  ])("%s is outside", (url) => {
    expect(isInternalUrl(url)).toBe(false);
  });
});

describe("revealed", () => {
  const issue = Issue.fromEvent(
    Event.Event.cases.LogError.make({
      id: "event",
      host: "laptop",
      source: "journal",
      timestamp: 0,
      severity: "err",
      identifier: "example",
      message: "Lost <device:0123abcd> at <ip:89abcdef>",
    }),
  );

  const event = Event.Event.cases.LogError.make({
    id: "event",
    host: "laptop",
    source: "journal",
    timestamp: 0,
    severity: "err",
    identifier: "example",
    unit: "example@<user:aaaabbbb>.service",
    message: "Lost <device:0123abcd> at <ip:89abcdef>",
    breadcrumbs: ["Connecting to <device:0123abcd>"],
  });

  const work = (
    known: Record<string, string>,
  ): Pick<Work["Service"], "values"> => ({
    values: (tokens) =>
      Effect.succeed(
        tokens.flatMap((token) => {
          const value = known[token];

          return value === undefined ? [] : [{ token, kind: "device", value }];
        }),
      ),
  });

  test("shows the values this machine keeps, and leaves the rest as tokens", async () => {
    const shown = await Effect.runPromise(
      revealed(work({ "<device:0123abcd>": "Desk lamp" }), issue, [event]),
    );

    // An issue's title is its template, which never holds a token.
    expect(shown.issue.title).toBe("example: Lost <device> at <ip>");
    expect(shown.events[0]?.message).toBe("Lost Desk lamp at <ip:89abcdef>");
    expect(shown.events[0]?.breadcrumbs).toEqual(["Connecting to Desk lamp"]);
    expect(shown.events[0]?.unit).toBe("example@<user:aaaabbbb>.service");
    expect(shown.issue.id).toBe(issue.id);
  });

  test("changes nothing when this machine keeps no values, as for a worker", async () => {
    const shown = await Effect.runPromise(revealed(work({}), issue, [event]));

    expect(shown.issue).toEqual(issue);
    expect(shown.events).toEqual([event]);
  });
});
