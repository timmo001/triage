import { describe, expect, test } from "bun:test";
import { Fingerprint } from "@timmo001/effect-triage";
import { Option } from "effect";
import { makeRedact, regularUsers } from "../redact.js";
import type { Entry } from "./Entry.js";
import { MessageId, toEvent, toWarning } from "./toEvent.js";

const redact = makeRedact({ users: ["alex"], hosts: ["laptop"] });

const entry = (fields: Partial<Entry>): Entry => ({
  __CURSOR: "s=1;i=2",
  __REALTIME_TIMESTAMP: 1_700_000_000_123_456,
  _HOSTNAME: "laptop",
  _BOOT_ID: "boot",
  ...fields,
});

const coredump = `Process 4242 (zsh) of user 1000 dumped core.

Module /usr/bin/zsh without build-id.
Stack trace of thread 4242:
#0  0x00005f1e2a3b4c5d unsetparam_pm (/usr/bin/zsh + 0x9c5d)
#1  0x00005f1e2a3b4d6e n/a (/home/alex/.local/lib/libplugin.so + 0x1d6e)
#2  0x00005f1e2a3b4e7f runshfunc (/usr/bin/zsh + 0x2e7f)
#3  0x00007f1e2a3b4f80 n/a (n/a + 0x0)

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

    expect(crash.id).toBe(Fingerprint.issueId("s=1;i=2"));
    expect(crash.bootId).toBe(Fingerprint.issueId("boot"));
    expect(crash).toMatchObject({
      host: "<host>",
      timestamp: 1_700_000_000_123,
      message: "Process 4242 (zsh) of user 1000 dumped core.",
      frames: [
        { function: "unsetparam_pm", module: "/usr/bin/zsh" },
        { module: "~/.local/lib/libplugin.so" },
        { function: "runshfunc", module: "/usr/bin/zsh" },
        {},
      ],
    });
  });

  test("leaves out a frame's module when systemd-coredump doesn't know it", () => {
    const crash = event({
      MESSAGE_ID: MessageId.coredump,
      PRIORITY: "2",
      MESSAGE: `Stack trace of thread 4242:
#0  0x00007f1e2a3b4f80 n/a (n/a + 0x0)
#1  0x00005f1e2a3b4e7f runshfunc (/usr/bin/zsh + 0x2e7f)`,
      COREDUMP_EXE: "/usr/bin/zsh",
      COREDUMP_SIGNAL_NAME: "SIGSEGV",
    });

    expect(Fingerprint.fingerprint(crash)).toBe(
      "crash|zsh|SIGSEGV|?|runshfunc",
    );
  });

  test("skips job failures, which repeat the unit failure", () => {
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

  test("decodes byte array fields", () => {
    const log = event({
      PRIORITY: "3",
      MESSAGE: Array.from(new TextEncoder().encode("bad \u00e9")),
    });

    expect(log.message).toBe("bad é");
  });
});

describe("toWarning", () => {
  test("redacts a warning and reduces it to its template", () => {
    const warning = Option.getOrThrow(
      toWarning(
        entry({
          PRIORITY: "4",
          SYSLOG_IDENTIFIER: "kdeconnectd",
          _SYSTEMD_USER_UNIT: "app-kdeconnectd@1234.service",
          MESSAGE: 'No uuids found for "/home/alex/phone" at 10.0.0.5',
        }),
        redact,
      ),
    );

    expect(warning).toEqual({
      host: "<host>",
      bootId: Fingerprint.issueId("boot"),
      identifier: "kdeconnectd",
      unit: "app-kdeconnectd@<n>.service",
      template: 'No uuids found for "~<path>" at <ip>',
      example: 'No uuids found for "~/phone" at <ip>',
      count: 1,
      firstSeen: 1_700_000_000_123,
      lastSeen: 1_700_000_000_123,
    });
  });

  test("skips the kernel, other priorities and events", () => {
    const skipped = [
      { PRIORITY: "4", _TRANSPORT: "kernel", MESSAGE: "[UFW BLOCK] IN=wlan0" },
      { PRIORITY: "3", SYSLOG_IDENTIFIER: "app", MESSAGE: "failed" },
      { PRIORITY: "5", SYSLOG_IDENTIFIER: "app", MESSAGE: "notice" },
      {
        PRIORITY: "4",
        MESSAGE_ID: MessageId.unitFailed,
        UNIT: "sync.service",
        MESSAGE: "sync.service: Failed with result 'exit-code'.",
      },
    ];

    expect(skipped.map((fields) => toWarning(entry(fields), redact))).toEqual(
      skipped.map(() => Option.none()),
    );
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
