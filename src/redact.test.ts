import { describe, expect, test } from "bun:test";
import { makeRedact } from "./redact.js";

const redact = makeRedact({ users: ["alex"], hosts: ["laptop"] });

describe("redact", () => {
  test.each([
    ["password=hunter2 token: abc", "password=<redacted> token: <redacted>"],
    ["Authorization: Bearer abc.def", "Authorization: <redacted> <redacted>"],
    ["mail alex.smith+x@example.co.uk now", "mail <email> now"],
    ["sent to sam@example.com.", "sent to <email>."],
    ["getty@tty1.service failed", "getty@tty1.service failed"],
    ["open /home/alex/.config/app.json", "open ~/.config/app.json"],
    ["fs 1f0e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b", "fs <uuid>"],
    ["machine 0123456789abcdef0123456789abcdef", "machine <id>"],
    ["dev 80:C3:BA:7B:93:4E and 80_C3_BA_7B_93_4E", "dev <mac> and <mac>"],
    ["from 192.168.1.20:8080", "from <ip>:8080"],
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
