import { describe, expect, test } from "bun:test";
import { Fingerprint, Issue } from "@timmo001/effect-triage";
import type { Entry } from "../journal/Entry.js";
import { makeRedact } from "../redact.js";
import {
  coreEvent,
  coreRecords,
  coreWarning,
  integrationOf,
  lastRecordStart,
  withBreadcrumbs,
} from "./coreLog.js";

const redact = makeRedact({ hosts: ["kitchen-pi"] });

let cursor = 0;

const line = (message: string, timestamp = 1_700_000_000_123_456): Entry => {
  cursor += 1;

  return {
    __CURSOR: `s=1;i=${cursor}`,
    __REALTIME_TIMESTAMP: timestamp,
    _HOSTNAME: "homeassistant",
    _BOOT_ID: "boot",
    SYSLOG_IDENTIFIER: "homeassistant",
    MESSAGE: message,
  };
};

const traceback = [
  line(
    "\x1b[31m2026-10-10 12:00:00.123 ERROR (MainThread) [homeassistant.components.hue] Error setting up entry Bridge at 192.168.1.20\x1b[0m",
  ),
  line("Traceback (most recent call last):"),
  line(
    '  File "/usr/src/homeassistant/homeassistant/config_entries.py", line 761, in async_setup',
  ),
  line("    result = await component.async_setup_entry(hass, self)"),
  line("TimeoutError"),
];

describe("coreRecords", () => {
  test("joins a traceback to the record that logged it", () => {
    const [record] = coreRecords(traceback);

    expect(record?.severity).toBe("err");
    expect(record?.logger).toBe("homeassistant.components.hue");
    expect(record?.lines).toHaveLength(5);
    expect(record?.lines.at(-1)).toBe("TimeoutError");
  });

  test("leaves out info, and lines before the first record", () => {
    const records = coreRecords([
      line("    raise ValueError"),
      line(
        "2026-10-10 12:00:01.000 INFO (MainThread) [homeassistant.core] Starting",
      ),
      line(
        "2026-10-10 12:00:02.000 WARNING (SyncWorker_3) [custom_components.thing] Slow update",
      ),
    ]);

    expect(records.map((record) => record.severity)).toEqual(["warning"]);
  });
});

describe("lastRecordStart", () => {
  test("finds where the last record starts, so its traceback can be held back", () => {
    expect(lastRecordStart([...traceback, ...traceback])).toBe(5);
    expect(lastRecordStart(traceback.slice(1))).toBeUndefined();
  });
});

describe("coreEvent", () => {
  test("is a redacted log error from the logger, titled by its first line", () => {
    const [record] = coreRecords(traceback);
    const event = record && coreEvent(record, "home-assistant", redact);

    expect(event?._tag).toBe("LogError");
    expect(event?.host).toBe("home-assistant");
    expect(event?.source).toBe("homeassistant-core");
    expect(event?.identifier).toBe("homeassistant.components.hue");
    expect(event?.integration).toEqual({ domain: "hue", custom: false });
    expect(event?.bootId).toBe(Fingerprint.issueId("boot"));
    expect(event?.message).toContain("Bridge at <ip>");
    expect(event?.message).toEndWith("TimeoutError");

    if (event !== undefined) {
      expect(Issue.title(event)).toBe(
        "homeassistant.components.hue: Error setting up entry Bridge at <ip>",
      );
    }
  });
});

describe("withBreadcrumbs", () => {
  const at = (seconds: number, message: string) =>
    line(message, (1_700_000_000 + seconds) * 1_000_000);

  test("keeps what Core logged in the 30 seconds before, across batches", () => {
    const first = withBreadcrumbs(
      [],
      coreRecords([
        at(
          0,
          "2026-10-10 12:00:00.000 WARNING (MainThread) [homeassistant.components.demo] Too old",
        ),
        at(
          40,
          "2026-10-10 12:00:40.000 WARNING (MainThread) [homeassistant.components.demo] Timed out",
        ),
      ]),
    );

    const second = withBreadcrumbs(
      first.recent,
      coreRecords([
        at(
          50,
          "2026-10-10 12:00:50.000 ERROR (MainThread) [homeassistant.components.demo.coordinator] Error fetching demo data",
        ),
      ]),
    );

    const [error] = second.records;

    expect(error?.breadcrumbs).toEqual([
      "WARNING [homeassistant.components.demo] Timed out",
    ]);

    const event =
      error &&
      coreEvent(error.record, "home-assistant", redact, error.breadcrumbs);

    expect(event?.breadcrumbs).toEqual([
      "WARNING [homeassistant.components.demo] Timed out",
    ]);
  });
});

describe("integrationOf", () => {
  test("reads built-in and custom integrations from the logger", () => {
    expect(integrationOf("homeassistant.components.demo.coordinator")).toEqual({
      domain: "demo",
      custom: false,
    });
    expect(integrationOf("custom_components.thing")).toEqual({
      domain: "thing",
      custom: true,
    });
    expect(integrationOf("homeassistant.core")).toBeUndefined();
  });
});

describe("coreWarning", () => {
  test("counts a warning under its logger", () => {
    const [record] = coreRecords([
      line(
        "2026-10-10 12:00:02.000 WARNING (SyncWorker_3) [custom_components.thing] Update took 12 seconds",
      ),
    ]);

    const warning = record && coreWarning(record, "home-assistant", redact);

    expect(warning?.identifier).toBe("custom_components.thing");
    expect(warning?.template).toBe("Update took <n> seconds");
    expect(
      record && coreEvent(record, "home-assistant", redact),
    ).toBeUndefined();
  });
});
