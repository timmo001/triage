import { describe, expect, test } from "bun:test";
import { issueId } from "./IssueTools.js";

describe("issueId", () => {
  test.each([
    ["0123456789abcdef", "0123456789abcdef"],
    [" 0123456789abcdef\n", "0123456789abcdef"],
    ["https://triage.example.com/issues/0123456789abcdef", "0123456789abcdef"],
    [
      "http://homeassistant.local:8123/api/hassio_ingress/AbC-123/issues/0123456789abcdef/?tab=events#latest",
      "0123456789abcdef",
    ],
    ["https://triage.example.com/issues/a%2Fb", "a/b"],
  ])("%p is %p", (input, expected) => {
    expect(issueId(input)).toBe(expected);
  });
});
