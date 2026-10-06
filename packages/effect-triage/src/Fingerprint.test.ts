import { describe, expect, test } from "bun:test";
import { Event } from "./Event.js";
import { fingerprint, issueId, template, unitTemplate } from "./Fingerprint.js";

describe("template", () => {
  test("replaces the parts that change between occurrences", () => {
    expect(
      template(
        "src/service.c:btd_service_connect() a2dp-sink profile connect failed for 80:C3:BA:7B:93:4E: Device or resource busy (-16)",
      ),
    ).toBe(
      "src/service.c:btd_service_connect() a2dp-sink profile connect failed for <mac>: Device or resource busy (<n>)",
    );
    expect(
      template(
        "Failed to open /home/aidan/.config/app.json for 1f0e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b at 0x7ffd1234 from 192.168.1.20:8080",
      ),
    ).toBe("Failed to open <path> for <uuid> at <hex> from <ip>");
    expect(
      template("pw.node: (bluez_output.80_C3_BA_7B_93_4E.1) usb 1-6:1.0"),
    ).toBe("pw.node: (bluez_output.<mac>.<n>) usb <n>-<n>:<n>");
  });
});

describe("fingerprint", () => {
  test("groups crashes by executable, signal and top frames", () => {
    const crash = Event.cases.Crash.make({
      id: "event",
      host: "laptop",
      source: "journal",
      timestamp: 0,
      severity: "crit",
      message: "Process 1 (ghostty) dumped core.",
      executable: "/usr/bin/ghostty",
      signal: "SIGSEGV",
      frames: [
        { module: "ghostty" },
        { function: "g_main_context_dispatch", module: "libglib-2.0.so.0" },
        { function: "main", module: "ghostty" },
        { function: "__libc_start_main", module: "libc.so.6" },
      ],
    });

    expect(fingerprint(crash)).toBe(
      "crash|ghostty|SIGSEGV|ghostty|g_main_context_dispatch|main",
    );
  });

  test("groups numbered instances of a templated unit", () => {
    expect(unitTemplate("polkit-agent-helper@0-1-29900_10836-0.service")).toBe(
      "polkit-agent-helper@<n>.service",
    );
    expect(unitTemplate("getty@tty1.service")).toBe("getty@tty1.service");
  });

  test("groups transient scopes and generated units", () => {
    expect(unitTemplate("app-Hyprland-gtk\\x2dlaunch-c185ed16.scope")).toBe(
      "app-Hyprland-gtk\\x2dlaunch-<id>.scope",
    );
    expect(unitTemplate("app-heroic-2008598.scope")).toBe(
      "app-heroic-<id>.scope",
    );
    expect(unitTemplate("run-p1796882-i1823824.service")).toBe(
      "run-<id>.service",
    );
    expect(unitTemplate("session-1.scope")).toBe("session-<id>.scope");
    expect(unitTemplate("app-walker@autostart.service")).toBe(
      "app-walker@autostart.service",
    );
  });

  test("issue IDs are stable", () => {
    expect(issueId("a")).toBe("af63dc4c8601ec8c");
  });
});
