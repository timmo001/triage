import type { Event, Issue } from "@timmo001/effect-triage";
import { Effect, Struct } from "effect";
import type { Work } from "./Work.js";

const privateIpv4 = (octets: ReadonlyArray<number>) => {
  const [a = -1, b = -1] = octets;

  return (
    a === 127 ||
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
};

/** Names that only mean something on a local network. */
const localSuffixes = [
  ".local",
  ".lan",
  ".home.arpa",
  ".internal",
  ".localhost",
];

/**
 * Whether `url` is on this machine or its own network: a loopback, private or
 * link-local address, `localhost`, a single-label name such as a container's,
 * or a name only a local network uses, such as `nas.local`. Anything else,
 * including a URL that can't be read, counts as outside.
 */
export const isInternalUrl = (url: string): boolean => {
  if (!URL.canParse(url)) {
    return false;
  }

  const host = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
    return privateIpv4(host.split(".").map(Number));
  }

  if (host.includes(":")) {
    return host === "::1" || /^(?:fe[89ab]|f[cd])[0-9a-f]*:/.test(host);
  }

  return (
    host === "localhost" ||
    !host.includes(".") ||
    localSuffixes.some((suffix) => host.endsWith(suffix))
  );
};

/** A redaction token, such as `<ip:71d0a3c2>`. */
const tokenPattern = /<[a-z]+:[0-9a-f]{8}>/g;

/**
 * An issue and its events with each redaction token whose value this machine
 * keeps replaced by that value, for a model on this machine or its own network.
 * Tokens without a known value stay as they are. Only text that goes into a
 * model's description changes.
 */
export const revealed = Effect.fnUntraced(function* (
  work: Pick<Work["Service"], "values">,
  issue: Issue.Issue,
  events: ReadonlyArray<Event.Event>,
) {
  const texts = [
    issue.title,
    ...events.flatMap((event) => [
      event.message,
      event.unit ?? "",
      ...(event.breadcrumbs ?? []),
    ]),
  ];

  const tokens = [
    ...new Set(texts.flatMap((text) => text.match(tokenPattern) ?? [])),
  ];

  if (tokens.length === 0) {
    return { issue, events };
  }

  const values = new Map(
    (yield* work.values(tokens)).map(({ token, value }) => [token, value]),
  );

  const reveal = (text: string) =>
    text.replace(tokenPattern, (token) => values.get(token) ?? token);

  return {
    issue: Struct.evolve(issue, { title: reveal }),
    events: events.map((event) =>
      Struct.evolve(event, {
        message: reveal,
        unit: (unit) => (unit === undefined ? unit : reveal(unit)),
        breadcrumbs: (lines) => lines?.map(reveal),
      }),
    ),
  };
});
