import { Config, Context, Effect, FileSystem, Layer } from "effect";

const rules: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bBearer\s+\S+/gi, "Bearer <redacted>"],
  [
    /\b(password|passwd|secret|token|api[_-]?key|auth(?:orization)?)(\s*[=:]\s*)\S+/gi,
    "$1$2<redacted>",
  ],
  [
    /[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.(?!(?:service|socket|timer|target|mount|automount|scope|slice|path|swap|device)\b)[\w-]+(?![\w-]|\.[\w-])/g,
    "<email>",
  ],
  [/\/home\/[^/\s]+/g, "~"],
  [
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    "<uuid>",
  ],
  [/\b[0-9a-f]{2}([:_-])[0-9a-f]{2}(?:\1[0-9a-f]{2}){4}\b/gi, "<mac>"],
  [/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, "<ip>"],
  [/(?<![\w:])(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}(?:%\w+)?(?![\w:])/gi, "<ip>"],
  [
    /(?<![\w:])(?=[0-9a-f:]*[0-9a-f])(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,6})?::(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,6})?(?:%\w+)?(?![\w:])/gi,
    "<ip>",
  ],
  [/\b[0-9a-f]{32,}\b/gi, "<id>"],
  [/\b[A-Za-z0-9+_-]{40,}={0,2}/g, "<redacted>"],
  [/\b(serial(?:\s*number)?|SerialNumber)(\s*[=:]\s*)\S+/gi, "$1$2<serial>"],
  [/\b(ssid)(\s*[=:]?\s*)(?:(['"]).*?\3|\S+)/gi, "$1$2<ssid>"],
];

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const nameRule = (
  names: ReadonlyArray<string>,
  replacement: string,
): ReadonlyArray<readonly [RegExp, string]> => {
  const wanted = names.filter((name) => name.length > 0);

  return wanted.length === 0
    ? []
    : [
        [
          new RegExp(`\\b(?:${wanted.map(escape).join("|")})\\b`, "gi"),
          replacement,
        ],
      ];
};

/** Names that identify this machine or its people, replaced wherever they appear. */
export interface Identities {
  readonly users?: ReadonlyArray<string>;
  readonly hosts?: ReadonlyArray<string>;
}

/**
 * Remove secrets and personal details from text before it is stored or sent
 * anywhere: credentials, emails, home directories, UUIDs and other long IDs,
 * MAC and IP addresses, serial numbers, Wi-Fi network names, long token-like
 * strings, and the given user and host names.
 */
export const makeRedact = (identities: Identities = {}) => {
  const all = [
    ...rules,
    ...nameRule(identities.users ?? [], "<user>"),
    ...nameRule(identities.hosts ?? [], "<host>"),
  ];

  return (text: string): string =>
    all.reduce(
      (result, [pattern, replacement]) => result.replace(pattern, replacement),
      text,
    );
};

export type Redact = ReturnType<typeof makeRedact>;

/**
 * Redacts text with the rules alone, without any machine's names, for text
 * that reaches the server from elsewhere, such as notes.
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
 * Redacts text with this machine's hostname and regular user names added to
 * the rules, plus any other names in `$TRIAGE_REDACT_NAMES` (comma-separated),
 * such as a GitHub account. Everything triage stores or sends anywhere goes
 * through it.
 */
export class Redactor extends Context.Service<
  Redactor,
  { readonly redact: Redact }
>()("triage/Redactor") {
  static readonly layer = Layer.effect(
    Redactor,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;

      const read = (file: string) =>
        fs.readFileString(file).pipe(Effect.orElseSucceed(() => ""));

      const passwd = yield* read("/etc/passwd");
      const hostname = (yield* read("/proc/sys/kernel/hostname")).trim();

      const names = yield* Config.String("TRIAGE_REDACT_NAMES").pipe(
        Config.withDefault(""),
      );

      return Redactor.of({
        redact: makeRedact({
          users: [
            ...regularUsers(passwd),
            ...names.split(",").map((name) => name.trim()),
          ],
          hosts: [hostname],
        }),
      });
    }),
  );
}
