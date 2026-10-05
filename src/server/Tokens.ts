import {
  Context,
  Crypto,
  Effect,
  Layer,
  Option,
  Redacted,
  Schema,
} from "effect";
import { Base64Url, Hex } from "effect/encoding";
import { Store, StoreError, Token, TokenScope } from "../store/Store.js";

/**
 * A token's name. For a host it's what the server knows the host by, in place
 * of its real hostname, so choose something that doesn't identify the machine.
 */
export const TokenName = Schema.String.check(
  Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,62}$/),
);

export class TokenExists extends Schema.TaggedError<TokenExists>()(
  "TokenExists",
  { scope: TokenScope, owner: Schema.String },
) {
  override get message() {
    return `There's already a ${this.scope} called ${this.owner}`;
  }
}

export class TokenNotFound extends Schema.TaggedError<TokenNotFound>()(
  "TokenNotFound",
  { scope: TokenScope, owner: Schema.String },
) {
  override get message() {
    return `There's no ${this.scope} called ${this.owner}`;
  }
}

/**
 * Issues and checks the server's tokens. Host tokens can only upload events;
 * admin tokens can only read issues.
 */
export class Tokens extends Context.Service<
  Tokens,
  {
    /** Issue a token, which is only ever returned here. */
    issue(
      scope: TokenScope,
      name: string,
    ): Effect.Effect<Redacted.Redacted, TokenExists | StoreError>;
    /** The name a token belongs to in a scope, if any. */
    authenticate(
      scope: TokenScope,
      token: Redacted.Redacted,
    ): Effect.Effect<Option.Option<string>, StoreError>;
    list(scope: TokenScope): Effect.Effect<ReadonlyArray<Token>, StoreError>;
    revoke(
      scope: TokenScope,
      name: string,
    ): Effect.Effect<void, TokenNotFound | StoreError>;
  }
>()("triage/server/Tokens") {
  static readonly layer = Layer.effect(
    Tokens,
    Effect.gen(function* () {
      const store = yield* Store;
      const crypto = yield* Crypto.Crypto;

      const hash = (token: Redacted.Redacted) =>
        crypto
          .digest("SHA-256", new TextEncoder().encode(Redacted.value(token)))
          .pipe(Effect.map(Hex.encode), Effect.orDie);

      const issue = Effect.fn("Tokens.issue")(function* (
        scope: TokenScope,
        name: string,
      ) {
        const bytes = yield* crypto.randomBytes(32).pipe(Effect.orDie);
        const token = Redacted.make(Base64Url.encode(bytes));
        const added = yield* store.addToken(scope, name, yield* hash(token));

        if (!added) {
          return yield* new TokenExists({ scope, owner: name });
        }

        return token;
      });

      const authenticate = Effect.fn("Tokens.authenticate")(function* (
        scope: TokenScope,
        token: Redacted.Redacted,
      ) {
        return yield* store.tokenName(scope, yield* hash(token));
      });

      const revoke = Effect.fn("Tokens.revoke")(function* (
        scope: TokenScope,
        name: string,
      ) {
        const removed = yield* store.removeToken(scope, name);

        if (!removed) {
          return yield* new TokenNotFound({ scope, owner: name });
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
