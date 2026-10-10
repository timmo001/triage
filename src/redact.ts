import { createHmac } from "node:crypto";
import { Config, Context, Effect, FileSystem, Layer, Schema } from "effect";

/**
 * The kinds of personal detail redaction replaces with a token, which this
 * machine can show again. Secrets, long IDs and home directories are never
 * kept, and stay plain placeholders.
 */
export const Kind = Schema.Literals([
  "email",
  "ip",
  "mac",
  "serial",
  "ssid",
  "user",
  "host",
  "device",
  "entity",
  "area",
  "floor",
  "home",
]);

export type Kind = typeof Kind.Type;

export const isKind = Schema.is(Kind);

/** A redacted value and the token that replaced it. */
export interface Redaction {
  readonly token: string;
  readonly kind: Kind;
  readonly value: string;
}

/**
 * What replaces a redacted value: a token such as `<ip:71d0a3c2e94b>` when this
 * machine keeps the values behind its tokens, or a plain placeholder such as
 * `<ip>` otherwise.
 */
export type Mark = (kind: Kind, value: string) => string;

/** A plain placeholder, such as `<ip>`, which keeps nothing. */
export const placeholder: Mark = (kind) => `<${kind}>`;

/**
 * How long a token's hash is, in hex digits: 48 bits, so a server holding many
 * hosts' values won't see two different values share a token.
 */
const tokenLength = 12;

/**
 * Mark values with tokens made from `key`, so the same value always gets the
 * same token on this machine but can't be worked out from it elsewhere, and
 * pass each one to `remember`. Values are compared ignoring case.
 */
export const tokenize =
  (key: Uint8Array, remember: (redaction: Redaction) => void): Mark =>
  (kind, value) => {
    const hash = createHmac("sha256", key)
      .update(`${kind}\0${value.toLowerCase()}`)
      .digest("hex")
      .slice(0, tokenLength);

    const token = `<${kind}:${hash}>`;

    remember({ token, kind, value });

    return token;
  };

type Rule = (text: string, mark: Mark) => string;

const fixed =
  (pattern: RegExp, replacement: string): Rule =>
  (text) =>
    text.replace(pattern, replacement);

const marked =
  (pattern: RegExp, kind: Kind): Rule =>
  (text, mark) =>
    text.replace(pattern, (value) => mark(kind, value));

/** A label, its separator and then the value, as in `serial: ABC123`. */
const labelled =
  (pattern: RegExp, kind: Kind): Rule =>
  (text, mark) =>
    text.replace(
      pattern,
      (_, label: string, separator: string, value: string) =>
        `${label}${separator}${mark(kind, value)}`,
    );

const rules: ReadonlyArray<Rule> = [
  // Credentials in a URL, as in a private Git repository's address.
  fixed(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, "$1<redacted>@"),
  fixed(/\bBearer\s+\S+/gi, "Bearer <redacted>"),
  fixed(
    /\b(password|passwd|secret|token|api[_-]?key|auth(?:orization)?)(\s*[=:]\s*)\S+/gi,
    "$1$2<redacted>",
  ),
  // An email address, but not a templated unit's name, such as
  // getty@tty1.service or sshd@3-10.0.0.1:22-10.0.0.2:51234.service, whose
  // instance can hold dots, colons and escapes before its unit type.
  marked(
    /[\w.+-]+@(?![\w.:\\@-]*\.(?:service|socket|timer|target|mount|automount|scope|slice|path|swap|device)(?![\w-]))[\w-]+(?:\.[\w-]+)*\.[\w-]+(?![\w-]|\.[\w-])/g,
    "email",
  ),
  fixed(/\/home\/[^/\s]+/g, "~"),
  fixed(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    "<uuid>",
  ),
  marked(/\b[0-9a-f]{2}([:_-])[0-9a-f]{2}(?:\1[0-9a-f]{2}){4}\b/gi, "mac"),
  marked(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, "ip"),
  // An IPv6 address may be followed by a colon, as in "from <address>: ...",
  // just not by another group.
  marked(
    /(?<![\w:])(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}(?:%\w+)?(?!\w|:[0-9a-f:])/gi,
    "ip",
  ),
  marked(
    /(?<![\w:])(?=[0-9a-f:]*[0-9a-f])(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,6})?::(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,6})?(?:%\w+)?(?!\w|:[0-9a-f:])/gi,
    "ip",
  ),
  fixed(/\b[0-9a-f]{32,}\b/gi, "<id>"),
  fixed(/\b[A-Za-z0-9+_-]{40,}={0,2}/g, "<redacted>"),
  // Account and list IDs, such as a Google Tasks list's: 16 or more letters
  // and digits mixing upper and lower case and digits, which words don't.
  fixed(
    /\b(?=[A-Za-z0-9]*[A-Z])(?=[A-Za-z0-9]*[a-z])(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{16,}={0,2}(?![\w+/-])/g,
    "<id>",
  ),
  labelled(
    /\b(serial(?:\s*number)?|SerialNumber)(\s*[=:]\s*)(\S+)/gi,
    "serial",
  ),
  labelled(/\b(ssid)(\s*[=:]?\s*)((?:(['"]).*?\4|\S+))/gi, "ssid"),
];

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const nameRule = (
  names: ReadonlyArray<string>,
  kind: Kind,
): ReadonlyArray<Rule> => {
  const wanted = names.filter((name) => name.length > 0);

  return wanted.length === 0
    ? []
    : [
        marked(
          new RegExp(`\\b(?:${wanted.map(escape).join("|")})\\b`, "gi"),
          kind,
        ),
      ];
};

/** Names that identify this machine or its people, replaced wherever they appear. */
export interface Identities {
  readonly users?: ReadonlyArray<string>;
  readonly hosts?: ReadonlyArray<string>;
}

/**
 * Remove secrets and personal details from text before it is stored or sent
 * anywhere: credentials, emails, home directories, UUIDs, account IDs and
 * other long IDs, MAC and IP addresses, serial numbers, Wi-Fi network names,
 * long token-like strings, and the given user and host names. Personal
 * details are marked with `mark`, plain placeholders unless given.
 */
export const makeRedact = (
  identities: Identities = {},
  mark: Mark = placeholder,
) => {
  const all = [
    ...rules,
    ...nameRule(identities.users ?? [], "user"),
    ...nameRule(identities.hosts ?? [], "host"),
  ];

  return (text: string): string =>
    all.reduce((result, rule) => rule(result, mark), text);
};

export type Redact = ReturnType<typeof makeRedact>;

/**
 * Redacts text with the rules alone, without any machine's names or tokens,
 * for text that reaches the server from elsewhere, such as notes.
 */
export const redactGeneric: Redact = makeRedact();

/** The first and last UIDs systemd gives regular users. */
const userIds = { min: 1000, max: 60_000 } as const;

/** Parse regular users' names from the lines of `/etc/passwd`. */
export const regularUsers = (passwd: string): ReadonlyArray<string> =>
  passwd.split("\n").flatMap((line) => {
    const [name = "", , uid = ""] = line.split(":");
    const id = Number(uid);

    return name !== "" && id >= userIds.min && id <= userIds.max ? [name] : [];
  });

/**
 * Where this machine keeps the key redaction tokens are made with and the
 * values behind them. Neither ever leaves it.
 */
export class RedactionVault extends Context.Service<
  RedactionVault,
  {
    readonly key: Effect.Effect<Uint8Array, { readonly message: string }>;
    remember(
      redactions: ReadonlyArray<Redaction>,
    ): Effect.Effect<void, { readonly message: string }>;
  }
>()("triage/RedactionVault") {}

/** How often newly seen tokens' values are written to the vault. */
const rememberEvery = "5 seconds";

/**
 * This machine's hostname and regular user names, plus any other names in
 * `$TRIAGE_REDACT_NAMES` (comma-separated).
 */
const identities = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;

  const read = (file: string) =>
    fs.readFileString(file).pipe(Effect.orElseSucceed(() => ""));

  const passwd = yield* read("/etc/passwd");
  const hostname = (yield* read("/proc/sys/kernel/hostname")).trim();

  const names = yield* Config.String("TRIAGE_REDACT_NAMES").pipe(
    Config.withDefault(""),
  );

  return {
    hostname,
    users: [
      ...regularUsers(passwd),
      ...names.split(",").map((name) => name.trim()),
    ],
  };
});

/**
 * Redacts text with this machine's hostname and regular user names added to
 * the rules, plus any other names in `$TRIAGE_REDACT_NAMES` (comma-separated),
 * such as a GitHub account. Everything triage stores or sends anywhere goes
 * through it. Personal details become tokens, whose values go to the vault.
 */
export class Redactor extends Context.Service<
  Redactor,
  {
    readonly redact: Redact;
    /**
     * Redacts like `redact`, and another machine's hostname too, for a
     * journal from a machine other than this one, such as a Home Assistant
     * app's host.
     */
    readonly withHost: (hostname: string) => Redact;
    /** Marks a personal detail found by other rules, such as Home Assistant's names. */
    readonly mark: Mark;
  }
>()("triage/Redactor") {
  /**
   * Plain placeholders, keeping nothing, for text whose tokens nothing could
   * show, such as notes an admin sends to another machine's server.
   */
  static readonly layerPlain = Layer.effect(
    Redactor,
    Effect.gen(function* () {
      const { users, hostname } = yield* identities;

      return Redactor.of({
        redact: makeRedact({ users, hosts: [hostname] }),
        withHost: (other) => makeRedact({ users, hosts: [hostname, other] }),
        mark: placeholder,
      });
    }),
  );

  static readonly layer = Layer.effect(
    Redactor,
    Effect.gen(function* () {
      const vault = yield* RedactionVault;
      const { users, hostname } = yield* identities;

      // Values seen since they were last written, and every token written.
      const pending = new Map<string, Redaction>();
      const remembered = new Set<string>();

      const flush = Effect.suspend(() => {
        const batch = [...pending.values()];

        pending.clear();

        return vault.remember(batch).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              for (const { token } of batch) {
                remembered.add(token);
              }
            }),
          ),
          Effect.catch((error) =>
            Effect.logWarning(
              `Couldn't keep the values behind redaction tokens: ${error.message}`,
            ),
          ),
        );
      });

      const mark = yield* vault.key.pipe(
        Effect.map((key) =>
          tokenize(key, (redaction) => {
            if (!remembered.has(redaction.token)) {
              pending.set(redaction.token, redaction);
            }
          }),
        ),
        Effect.catch((error) =>
          Effect.logWarning(
            `Redacting with plain placeholders, as the redaction key couldn't be read: ${error.message}`,
          ).pipe(Effect.as(placeholder)),
        ),
      );

      yield* flush.pipe(
        Effect.delay(rememberEvery),
        Effect.forever,
        Effect.forkScoped,
      );

      yield* Effect.addFinalizer(() => flush);

      return Redactor.of({
        redact: makeRedact({ users, hosts: [hostname] }, mark),
        withHost: (other) =>
          makeRedact({ users, hosts: [hostname, other] }, mark),
        mark,
      });
    }),
  );
}
