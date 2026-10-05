import { describe, expect, test } from "bun:test";
import { Event, Fingerprint } from "@timmo001/effect-triage";
import { Option } from "effect";
import { makeRedact, regularUsers } from "../redact.js";
import type { Entry } from "./Entry.js";
import { MessageId, toEvent } from "./toEvent.js";

const redact = makeRedact(["alex"]);

const entry = (fields: Partial<Entry>): Entry => ({
  __CURSOR: "s=1;i=2",
  __REALTIME_TIMESTAMP: 1_700_000_000_123_456,
  _HOSTNAME: "omarchy",
  _BOOT_ID: "boot",
  ...fields,
});

const coredump = `Process 4242 (zsh) of user 1000 dumped core.

Module /usr/bin/zsh without build-id.
Stack trace of thread 4242:
#0  0x00005f1e2a3b4c5d unsetparam_pm (/usr/bin/zsh + 0x9c5d)
#1  0x00005f1e2a3b4d6e n/a (/home/alex/.local/lib/libplugin.so + 0x1d6e)
#2  0x00005f1e2a3b4e7f runshfunc (/usr/bin/zsh + 0x2e7f)

Stack trace of thread 4243:
#0  0x00007f0000000000 poll (libc.so.6 + 0x1000)
ELF object binary architecture: AMD x86-64`;

const event = (fields: Partial<Entry>) =>
  Option.getOrThrow(toEvent(entry(fields), redact));

describe("toEvent", () => {
  test("reads a core dump's crashing thread", () => {
    const crash = event({
      MESSAGE_ID: MessageId.coredump,
      PRIORITY: "2",
      MESSAGE: coredump,
      COREDUMP_EXE: "/usr/bin/zsh",
      COREDUMP_COMM: "zsh",
      COREDUMP_SIGNAL_NAME: "SIGSEGV",
      COREDUMP_USER_UNIT: "app-zsh.scope",
    });

    expect(Event.Event.guards.Crash(crash)).toBe(true);
    expect(crash).toMatchObject({
      host: "omarchy",
      timestamp: 1_700_000_000_123,
      severity: "crit",
      identifier: "zsh",
      unit: "app-zsh.scope",
      message: "Process 4242 (zsh) of user 1000 dumped core.",
      signal: "SIGSEGV",
      frames: [
        { function: "unsetparam_pm", module: "/usr/bin/zsh" },
        { module: "~/.local/lib/libplugin.so" },
        { function: "runshfunc", module: "/usr/bin/zsh" },
      ],
    });
  });

  test("reads unit failures and skips the matching job failure", () => {
    const failure = event({
      MESSAGE_ID: MessageId.unitFailed,
      PRIORITY: "4",
      USER_UNIT: "sync.service",
      UNIT_RESULT: "exit-code",
      MESSAGE: "sync.service: Failed with result 'exit-code'.",
    });

    expect(Event.Event.guards.UnitFailure(failure)).toBe(true);
    expect(failure).toMatchObject({
      unit: "sync.service",
      result: "exit-code",
    });

    expect(
      toEvent(
        entry({
          MESSAGE_ID: "be02cf6855d2428ba40df7e9d022f03d",
          PRIORITY: "3",
          MESSAGE: "Failed to start sync.service.",
        }),
        redact,
      ),
    ).toEqual(Option.none());
  });

  test("keeps errors and drops quieter entries", () => {
    const log = event({
      PRIORITY: "3",
      SYSLOG_IDENTIFIER: "bluetoothd",
      _SYSTEMD_UNIT: "bluetooth.service",
      MESSAGE: "connect to 80:C3:BA:7B:93:4E failed for alex: Host is down",
    });

    expect(Event.Event.guards.LogError(log)).toBe(true);
    expect(log).toMatchObject({
      identifier: "bluetoothd",
      unit: "bluetooth.service",
      message: "connect to <mac> failed for <user>: Host is down",
    });

    expect(Fingerprint.fingerprint(log)).toBe(
      "log|bluetoothd|connect to <mac> failed for <user>: Host is down",
    );

    expect(
      toEvent(entry({ PRIORITY: "4", MESSAGE: "warning" }), redact),
    ).toEqual(Option.none());
  });

  test("decodes byte array fields", () => {
    const log = event({
      PRIORITY: "3",
      MESSAGE: Array.from(new TextEncoder().encode("bad \u00e9")),
    });

    expect(log.message).toBe("bad é");
  });
});

describe("regularUsers", () => {
  test("keeps only regular users", () => {
    expect(
      regularUsers(
        "root:x:0:0::/root:/bin/bash\nalex:x:1000:1000::/home/alex:/bin/zsh\nnobody:x:65534:65534::/:/usr/bin/nologin\n",
      ),
    ).toEqual(["alex"]);
  });
});
