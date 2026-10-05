import { Context, Effect, FileSystem, Layer } from "effect";

const rules: ReadonlyArray<readonly [RegExp, string]> = [
  [
    /\b(password|passwd|secret|token|api[_-]?key|auth(?:orization)?)(\s*[=:]\s*)\S+/gi,
    "$1$2<redacted>",
  ],
  [/\bBearer\s+\S+/gi, "Bearer <redacted>"],
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "<email>"],
  [/\/home\/[^/\s]+/g, "~"],
  [/\b[0-9a-f]{2}([:_-])[0-9a-f]{2}(?:\1[0-9a-f]{2}){4}\b/gi, "<mac>"],
  [/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, "<ip>"],
  [/\b[A-Za-z0-9+_-]{40,}={0,2}/g, "<redacted>"],
];

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Remove secrets and personal details from text before it is stored or sent
 * anywhere: credentials, emails, home directories, MAC and IP addresses, long
 * token-like strings, and the given user names.
 */
export const makeRedact = (users: ReadonlyArray<string> = []) => {
  const userRule: ReadonlyArray<readonly [RegExp, string]> =
    users.length === 0
      ? []
      : [
          [
            new RegExp(`\\b(?:${users.map(escape).join("|")})\\b`, "g"),
            "<user>",
          ],
        ];

  const all = [...rules, ...userRule];

  return (text: string): string =>
    all.reduce(
      (result, [pattern, replacement]) => result.replace(pattern, replacement),
      text,
    );
};

export type Redact = ReturnType<typeof makeRedact>;

/** The first and last UIDs systemd gives regular users. */
const userIds = { min: 1000, max: 60_000 } as const;

/** Parse regular users' names from the lines of `/etc/passwd`. */
export const regularUsers = (passwd: string): ReadonlyArray<string> =>
  passwd.split("\n").flatMap((line) => {
    const [name = "", , uid = ""] = line.split(":");
    const id = Number(uid);

    return name !== "" && id >= userIds.min && id <= userIds.max ? [name] : [];
  });

/** Redacts text with this machine's regular user names added to the rules. */
export class Redactor extends Context.Service<
  Redactor,
  { readonly redact: Redact }
>()("triage/Redactor") {
  static readonly layer = Layer.effect(
    Redactor,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;

      const passwd = yield* fs
        .readFileString("/etc/passwd")
        .pipe(Effect.orElseSucceed(() => ""));

      return Redactor.of({ redact: makeRedact(regularUsers(passwd)) });
    }),
  );
}
