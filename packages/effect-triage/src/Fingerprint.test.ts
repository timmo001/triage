import { describe, expect, test } from "bun:test";
import { Event } from "./Event.js";
import { fingerprint, issueId, template } from "./Fingerprint.js";

const base = {
  id: "cursor",
  host: "omarchy",
  timestamp: 0,
  severity: "err",
  message: "",
} as const;

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
    const crash = (pid: string) =>
      Event.cases.Crash.make({
        ...base,
        severity: "crit",
        message: `Process ${pid} (ghostty) dumped core.`,
        executable: "/usr/bin/ghostty",
        signal: "SIGSEGV",
        frames: [
          { module: "ghostty" },
          { function: "g_main_context_dispatch", module: "libglib-2.0.so.0" },
          { function: "main", module: "ghostty" },
          { function: "__libc_start_main", module: "libc.so.6" },
        ],
      });

    expect(fingerprint(crash("1"))).toBe(
      "crash|ghostty|SIGSEGV|ghostty|g_main_context_dispatch|main",
    );
    expect(fingerprint(crash("1"))).toBe(fingerprint(crash("2")));
  });

  test("groups log errors by identifier and template", () => {
    const log = (message: string) =>
      Event.cases.LogError.make({ ...base, identifier: "kernel", message });

    expect(
      fingerprint(log("ucsi_acpi USBC000:00: UCSI_GET_PDOS failed (-95)")),
    ).toBe(
      fingerprint(log("ucsi_acpi USBC000:01: UCSI_GET_PDOS failed (-95)")),
    );
  });

  test("issue IDs are stable 16 digit hex", () => {
    expect(issueId("crash|ghostty|SIGSEGV")).toMatch(/^[0-9a-f]{16}$/);
    expect(issueId("a")).toBe("af63dc4c8601ec8c");
  });
});
