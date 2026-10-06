import { Api } from "@timmo001/effect-triage";
import {
  Config,
  Context,
  Crypto,
  Effect,
  Layer,
  Option,
  Redacted,
} from "effect";
import { Base64Url, Hex } from "effect/encoding";
import { Store, StoreError, Token, TokenScope } from "../store/Store.js";

export const TokenName = Api.TokenName;

export const TokenExists = Api.TokenExists;

export const TokenNotFound = Api.TokenNotFound;

/** The admin name requests with the token from settings are made as. */
export const settingsAdmin = "settings";

/** The shortest token accepted from settings, to keep it unguessable. */
const minimumSettingsToken = 32;

/**
 * Issues and checks the server's tokens. Host tokens can only upload events,
 * admin tokens can only read issues and manage tokens, and worker tokens can
 * only fetch work and send back answers.
 */
export class Tokens extends Context.Service<
  Tokens,
  {
    /** Issue a token, which is only ever returned here. */
    issue(
      scope: TokenScope,
      name: string,
    ): Effect.Effect<Redacted.Redacted, Api.TokenExists | StoreError>;
    /** The name a token belongs to in a scope, if any. */
    authenticate(
      scope: TokenScope,
      token: Redacted.Redacted,
    ): Effect.Effect<Option.Option<string>, StoreError>;
    list(scope: TokenScope): Effect.Effect<ReadonlyArray<Token>, StoreError>;
    revoke(
      scope: TokenScope,
      name: string,
    ): Effect.Effect<void, Api.TokenNotFound | StoreError>;
  }
>()("triage/server/Tokens") {
  /**
   * Tokens kept in the store. `$TRIAGE_SERVER_ADMIN_TOKEN`, when set, also
   * works as an admin token, for servers you can't run `triage` commands on,
   * such as the Home Assistant app. It isn't stored or listed.
   */
  static readonly layer = Layer.effect(
    Tokens,
    Effect.gen(function* () {
      const store = yield* Store;
      const crypto = yield* Crypto.Crypto;

      const hash = (token: Redacted.Redacted) =>
        crypto
          .digest("SHA-256", new TextEncoder().encode(Redacted.value(token)))
          .pipe(Effect.map(Hex.encode), Effect.orDie);

      const settingsToken = yield* Config.option(
        Config.Redacted("TRIAGE_SERVER_ADMIN_TOKEN"),
      );

      if (
        Option.isSome(settingsToken) &&
        Redacted.value(settingsToken.value).length < minimumSettingsToken
      ) {
        return yield* Effect.die(
          new Error(
            `TRIAGE_SERVER_ADMIN_TOKEN must be at least ${minimumSettingsToken} characters`,
          ),
        );
      }

      const settingsHash = yield* Effect.transposeOption(
        Option.map(settingsToken, hash),
      );

      const issue = Effect.fn("Tokens.issue")(function* (
        scope: TokenScope,
        name: string,
      ) {
        const bytes = yield* crypto.randomBytes(32).pipe(Effect.orDie);
        const token = Redacted.make(Base64Url.encode(bytes));
        const added = yield* store.addToken(scope, name, yield* hash(token));

        if (!added) {
          return yield* new Api.TokenExists({ scope, owner: name });
        }

        return token;
      });

      const authenticate = Effect.fn("Tokens.authenticate")(function* (
        scope: TokenScope,
        token: Redacted.Redacted,
      ) {
        const tokenHash = yield* hash(token);

        if (scope === "admin" && Option.contains(settingsHash, tokenHash)) {
          return Option.some(settingsAdmin);
        }

        return yield* store.tokenName(scope, tokenHash);
      });

      const revoke = Effect.fn("Tokens.revoke")(function* (
        scope: TokenScope,
        name: string,
      ) {
        const removed = yield* store.removeToken(scope, name);

        if (!removed) {
          return yield* new Api.TokenNotFound({ scope, owner: name });
        }
      });

      return Tokens.of({
        issue,
        authenticate,
        list: (scope) => store.tokens(scope),
        revoke,
      });
    }),
  );
}
