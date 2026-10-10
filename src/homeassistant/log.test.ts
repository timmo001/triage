import { describe, expect, test } from "bun:test";
import { Fingerprint, Issue } from "@timmo001/effect-triage";
import type { Entry } from "../journal/Entry.js";
import { makeRedact } from "../redact.js";
import {
  eventOf,
  recordsOf,
  warningOf,
  integrationOf,
  isApp,
  isAppOn,
  isPlugin,
  lastRecordStart,
  supervisorSource,
  withBreadcrumbs,
} from "./log.js";

const redact = makeRedact({ hosts: ["kitchen-pi"] });

let cursor = 0;

const line = (
  message: string,
  timestamp = 1_700_000_000_123_456,
  program = "homeassistant",
): Entry => {
  cursor += 1;

  return {
    __CURSOR: `s=1;i=${cursor}`,
    __REALTIME_TIMESTAMP: timestamp,
    _HOSTNAME: "homeassistant",
    _BOOT_ID: "boot",
    SYSLOG_IDENTIFIER: program,
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

describe("recordsOf", () => {
  test("joins a traceback to the record that logged it", () => {
    const [record] = recordsOf(traceback);

    expect(record?.severity).toBe("err");
    expect(record?.logger).toBe("homeassistant.components.hue");
    expect(record?.lines).toHaveLength(5);
    expect(record?.lines.at(-1)).toBe("TimeoutError");
  });

  test("leaves out info, and lines before the first record", () => {
    const records = recordsOf([
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

describe("eventOf", () => {
  test("is a redacted log error from the logger, titled by its first line", () => {
    const [record] = recordsOf(traceback);

    const event = record && eventOf(record, { host: "home-assistant", redact });

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

describe("Supervisor records", () => {
  test("read like Core's, from the Supervisor's own source", () => {
    const [record] = recordsOf([
      line(
        "2026-10-10 12:00:00.123 ERROR (MainThread) [supervisor.addons.addon] Example app crashed at 10.0.0.5",
      ),
    ]);

    const event =
      record &&
      eventOf(record, {
        host: "home-assistant",
        redact,
        source: supervisorSource,
      });

    expect(event?.source).toBe("homeassistant-supervisor");
    expect(event?.identifier).toBe("supervisor.addons.addon");
    expect(event?.integration).toBeUndefined();
    expect(event?.message).toBe("Example app crashed at <ip>");
  });
});

describe("apps' records", () => {
  const app = (program: string, message: string) =>
    line(message, undefined, program);

  test("read levels in other programs' formats, each line on its own", () => {
    const records = recordsOf(
      [
        app("app_example_shell", "[12:00:00] ERROR: Can't read the config"),
        app("app_example_shell", "Usage: example [options]"),
        app("app_example_go", "2026-10-10 12:00:00 WRN Lost connection"),
        app("app_example_go", "2026-10-10 12:00:01 INF Reconnected"),
        app(
          "app_example_mesh",
          "3d.08:40:55.367 [W] Mle-----: Failed to attach",
        ),
        app("app_example_mesh", "3d.08:40:56.001 [N] Mle-----: Attached"),
        app("hassio_dns", "[ERROR] plugin/errors: 2 example.org. A: timeout"),
        app(
          "app_example_broker",
          "2026-10-10T12:00:00+01:00 [warning] msg: alarm",
        ),
        app(
          "app_example_node",
          "2026-10-10 12:00:00.000 ERROR  Storage Failed",
        ),
      ],
      { other: true },
    );

    expect(
      records.map((record) => [
        record.program,
        record.severity,
        record.logger,
        record.lines,
      ]),
    ).toEqual([
      [
        "app_example_shell",
        "err",
        "app_example_shell",
        ["Can't read the config"],
      ],
      ["app_example_go", "warning", "app_example_go", ["Lost connection"]],
      [
        "app_example_mesh",
        "warning",
        "app_example_mesh",
        ["Mle-----: Failed to attach"],
      ],
      [
        "hassio_dns",
        "err",
        "hassio_dns",
        ["plugin/errors: 2 example.org. A: timeout"],
      ],
      ["app_example_broker", "warning", "app_example_broker", ["msg: alarm"]],
      ["app_example_node", "err", "app_example_node", ["Storage Failed"]],
    ]);
  });

  test("read single-letter levels before a colon, as PulseAudio writes them", () => {
    const records = recordsOf(
      [
        app("hassio_audio", "E: [pulseaudio] module.c: Failed to load module"),
        app("hassio_audio", "I: [pulseaudio] main.c: Started"),
        app("hassio_audio", "E Not marked out"),
      ],
      { other: true },
    );

    expect(records.map((record) => [record.severity, record.lines])).toEqual([
      ["err", ["[pulseaudio] module.c: Failed to load module"]],
    ]);
  });

  test("leave out lines with no level, and words that aren't one", () => {
    expect(
      recordsOf(
        [
          app("app_example_go", "2026/10/10 12:00:00 control: error decoding"),
          app(
            "app_example_go",
            "2026/10/10 12:00:00 Error connecting to server",
          ),
          app("app_example_ntp", "2026-10-10T12:00:00Z Clock interference"),
        ],
        { other: true },
      ),
    ).toEqual([]);
  });

  test("name an app in Core's format by the app, and keep its tracebacks", () => {
    const records = recordsOf(
      [
        app(
          "app_example_python",
          "2026-10-10 12:00:00.000 ERROR (MainThread) [example.provider] Setup failed",
        ),
        app("app_example_go", "2026-10-10 12:00:00 INF Unrelated"),
        app("app_example_python", "Traceback (most recent call last):"),
        app("app_example_go", "unrelated output"),
        app("app_example_python", "example.SetupFailedError: refused"),
      ],
      { other: true },
    );

    expect(records).toHaveLength(1);
    expect(records[0]?.logger).toBe("app_example_python");
    expect(records[0]?.lines).toEqual([
      "[example.provider] Setup failed",
      "Traceback (most recent call last):",
      "example.SetupFailedError: refused",
    ]);
  });

  test("only count other formats when asked, as Core's log doesn't need them", () => {
    expect(
      recordsOf([app("homeassistant", "[ERROR] Not Core's format")]),
    ).toEqual([]);
  });

  test("keep breadcrumbs to the same app", () => {
    const [, error] = withBreadcrumbs(
      [],
      recordsOf(
        [
          app("app_example_go", "2026-10-10 12:00:00 WRN From another app"),
          app("app_example_shell", "[12:00:00] ERROR: Failed"),
        ],
        { other: true },
      ),
    ).records;

    expect(error?.breadcrumbs).toEqual([]);
  });
});

describe("isApp, isAppOn and isPlugin", () => {
  test("recognise the Supervisor plugins, but not the Supervisor", () => {
    expect(isPlugin("hassio_dns")).toBe(true);
    expect(isPlugin("hassio_audio")).toBe(true);
    expect(isPlugin("hassio_supervisor")).toBe(false);
    expect(isPlugin("app_core_example")).toBe(false);
  });

  test("recognise apps' containers, and triage's own by its hostname", () => {
    expect(isApp("app_core_example")).toBe(true);
    expect(isApp("addon_core_example")).toBe(true);
    expect(isApp("hassio_dns")).toBe(false);
    expect(isApp("homeassistant")).toBe(false);
    expect(isAppOn("app_0123abcd_triage", "0123abcd-triage")).toBe(true);
    expect(isAppOn("app_core_speech-to-text", "core-speech-to-text")).toBe(
      true,
    );
    expect(isAppOn("app_core_example", "0123abcd-triage")).toBe(false);
    expect(isAppOn("app_core_example", "")).toBe(false);
  });
});

describe("withBreadcrumbs", () => {
  const at = (seconds: number, message: string) =>
    line(message, (1_700_000_000 + seconds) * 1_000_000);

  test("keeps what Core logged in the 30 seconds before, across batches", () => {
    const first = withBreadcrumbs(
      [],
      recordsOf([
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
      recordsOf([
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
      eventOf(error.record, {
        host: "home-assistant",
        redact,
        breadcrumbs: error.breadcrumbs,
      });

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

describe("warningOf", () => {
  test("counts a warning under its logger", () => {
    const [record] = recordsOf([
      line(
        "2026-10-10 12:00:02.000 WARNING (SyncWorker_3) [custom_components.thing] Update took 12 seconds",
      ),
    ]);

    const warning = record && warningOf(record, "home-assistant", redact);

    expect(warning?.identifier).toBe("custom_components.thing");
    expect(warning?.template).toBe("Update took <n> seconds");
    expect(
      record && eventOf(record, { host: "home-assistant", redact }),
    ).toBeUndefined();
  });
});
