import { describe, expect, test } from "bun:test";
import { Fingerprint } from "@timmo001/effect-triage";
import { makeRedact, type Redaction, tokenize } from "./redact.js";

const redact = makeRedact({ users: ["alex"], hosts: ["laptop"] });

describe("redact", () => {
  test.each([
    ["password=hunter2 token: abc", "password=<redacted> token: <redacted>"],
    ["Authorization: Bearer abc.def", "Authorization: <redacted> <redacted>"],
    ["mail alex.smith+x@example.co.uk now", "mail <email> now"],
    ["sent to sam@example.com.", "sent to <email>."],
    ["getty@tty1.service failed", "getty@tty1.service failed"],
    ["app-example@autostart.service", "app-example@autostart.service"],
    [
      "app-org.example.App@autostart.service: Failed",
      "app-org.example.App@autostart.service: Failed",
    ],
    [
      "sshd@3-10.0.0.1:22-10.0.0.2:51234.service",
      "sshd@3-<ip>:22-<ip>:51234.service",
    ],
    [
      "systemd-fsck@dev-disk-by\\x2duuid-1234.service",
      "systemd-fsck@dev-disk-by\\x2duuid-1234.service",
    ],
    ["drop-in foo@bar.service.d", "drop-in foo@bar.service.d"],
    ["notify sam@example.com: done", "notify <email>: done"],
    ["open /home/alex/.config/app.json", "open ~/.config/app.json"],
    ["fs 1f0e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b", "fs <uuid>"],
    ["machine 0123456789abcdef0123456789abcdef", "machine <id>"],
    ["dev 80:C3:BA:7B:93:4E and 80_C3_BA_7B_93_4E", "dev <mac> and <mac>"],
    ["from 192.168.1.20:8080", "from <ip>:8080"],
    [
      "host='203-0-113-7.0123456789abcdef.plex.direct', port=8443",
      "host='<ip>.0123456789abcdef.plex.direct', port=8443",
    ],
    ["via ip-10-0-0-5.ec2.internal", "via ip-<ip>.ec2.internal"],
    [
      "on 2026-10-10 at 300-1-2-3.example.com, usb 1-6:1.0",
      "on 2026-10-10 at 300-1-2-3.example.com, usb 1-6:1.0",
    ],
    [
      "card 0-1-2-3.service and getty@1-2-3-4.service failed in 1-2-3-4.5",
      "card 0-1-2-3.service and getty@1-2-3-4.service failed in 1-2-3-4.5",
    ],
    ["via fe80::1c2b:3d4e:5f60:7a8b%wlan0 up", "via <ip> up"],
    ["to 2001:db8:85a3:0:0:8a2e:370:7334 ok", "to <ip> ok"],
    [
      "from fd00:1:2:3:4:5:6:7: Unexpected error",
      "from <ip>: Unexpected error",
    ],
    ["from fd6a::1: closed", "from <ip>: closed"],
    [
      "Timeout fetching list Ab3dEf6hIj9kLm2n data",
      "Timeout fetching list <id> data",
    ],
    ["usb SerialNumber: ABC123XYZ", "usb SerialNumber: <serial>"],
    ["joined SSID 'Home Network' ok", "joined SSID <ssid> ok"],
    ["user alex on laptop.local", "user <user> on <host>.local"],
    ["home-alex.mount failed", "home-<user>.mount failed"],
    [
      "from https://someone:abc123@example.com/someone/repo.git",
      "from https://<redacted>@example.com/someone/repo.git",
    ],
    [
      "mqtt://broker-user@broker:1883 down",
      "mqtt://<redacted>@broker:1883 down",
    ],
    [
      "see https://example.com/@someone and ws://supervisor/core",
      "see https://example.com/@someone and ws://supervisor/core",
    ],
  ])("%s", (input, output) => {
    expect(redact(input)).toBe(output);
  });

  test("leaves times, versions and C++ scopes alone", () => {
    const text = "at 12:30:45 in std::vector::at, version 6.17.1";

    expect(redact(text)).toBe(text);
  });

  test("leaves class names, models and paths alone", () => {
    const text =
      "HTTPSConnectionPool raised ReadFailedAPIError for OLED55G45LW at /usr/lib/python3.14/site-packages";

    expect(redact(text)).toBe(text);
  });
});

describe("tokenize", () => {
  const key = new Uint8Array(32).fill(7);

  const tokened = () => {
    const kept: Array<Redaction> = [];
    const mark = tokenize(key, (redaction) => kept.push(redaction));

    return {
      kept,
      redact: makeRedact({ users: ["alex"], hosts: ["laptop"] }, mark),
    };
  };

  test("gives the same value the same token, and keeps what it stands for", () => {
    const { kept, redact } = tokened();
    const first = redact("from 192.168.1.20 and 192.168.1.21, user Alex");
    const tokens = first.match(/<[a-z]+:[0-9a-f]{12}>/g) ?? [];

    expect(tokens).toHaveLength(3);
    expect(new Set(tokens).size).toBe(3);
    expect(redact("again from 192.168.1.20 as alex")).toBe(
      `again from ${tokens[0]} as ${tokens[2]}`,
    );
    expect(kept.map(({ kind, value }) => [kind, value])).toContainEqual([
      "ip",
      "192.168.1.20",
    ]);
  });

  test("makes tokens only from this key", () => {
    const other = makeRedact(
      {},
      tokenize(new Uint8Array(32).fill(8), () => {}),
    );

    expect(tokened().redact("from 192.168.1.20")).not.toBe(
      other("from 192.168.1.20"),
    );
  });

  test("never keeps secrets, IDs or home directories", () => {
    const { kept, redact } = tokened();

    expect(
      redact(
        "password=hunter2 for 1f0e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b in /home/sam",
      ),
    ).toBe("password=<redacted> for <uuid> in ~");
    expect(kept).toEqual([]);
  });

  test("groups like plain placeholders", () => {
    const message = "Connect to 192.168.1.20 for laptop failed after 30s";

    expect(Fingerprint.template(tokened().redact(message))).toBe(
      Fingerprint.template(makeRedact({ hosts: ["laptop"] })(message)),
    );
  });
});
