import { Api, TriageClient } from "@timmo001/effect-triage-client";
import { Config, Context, Effect, Layer, Redacted, Schema } from "effect";
import { FetchHttpClient } from "effect/http";
import type { Token, TokenScope } from "../store/Store.js";
import { Tokens } from "./Tokens.js";

/** The store or the server couldn't manage a token. */
export class TokenAdminError extends Schema.TaggedError<TokenAdminError>()(
  "TokenAdminError",
  { cause: Schema.Defect() },
) {
  override get message() {
    return this.cause instanceof Error
      ? this.cause.message
      : String(this.cause);
  }
}

const toTokenAdminError = (cause: unknown) => new TokenAdminError({ cause });

/** Adds, lists and revokes a server's tokens, here or over its API. */
export class TokenAdmin extends Context.Service<
  TokenAdmin,
  {
    issue(
      scope: TokenScope,
      name: string,
    ): Effect.Effect<Redacted.Redacted, Api.TokenExists | TokenAdminError>;
    list(
      scope: TokenScope,
    ): Effect.Effect<ReadonlyArray<Token>, TokenAdminError>;
    revoke(
      scope: TokenScope,
      name: string,
    ): Effect.Effect<void, Api.TokenNotFound | TokenAdminError>;
  }
>()("triage/server/TokenAdmin") {
  /** The tokens in this machine's server database. */
  static readonly layerLocal = Layer.effect(
    TokenAdmin,
    Effect.gen(function* () {
      const tokens = yield* Tokens;

      return TokenAdmin.of({
        issue: (scope, name) =>
          tokens
            .issue(scope, name)
            .pipe(
              Effect.catchTag("StoreError", (error) =>
                Effect.fail(toTokenAdminError(error)),
              ),
            ),
        list: (scope) =>
          tokens.list(scope).pipe(Effect.mapError(toTokenAdminError)),
        revoke: (scope, name) =>
          tokens
            .revoke(scope, name)
            .pipe(
              Effect.catchTag("StoreError", (error) =>
                Effect.fail(toTokenAdminError(error)),
              ),
            ),
      });
    }),
  );

  /** The tokens of the server at `url`, as the admin in `$TRIAGE_ADMIN_TOKEN`. */
  static readonly layerRemote = (url: string) =>
    Layer.unwrap(
      Effect.gen(function* () {
        const token = yield* Config.Redacted("TRIAGE_ADMIN_TOKEN");

        return Layer.effect(
          TokenAdmin,
          Effect.gen(function* () {
            const client = yield* TriageClient;

            return TokenAdmin.of({
              issue: (scope, name) =>
                client.tokens
                  .add({ params: { scope }, payload: { name } })
                  .pipe(
                    Effect.map(({ token }) => Redacted.make(token)),
                    Effect.mapError((error) =>
                      Schema.is(Api.TokenExists)(error)
                        ? error
                        : toTokenAdminError(error),
                    ),
                  ),
              list: (scope) =>
                client.tokens
                  .list({ params: { scope } })
                  .pipe(Effect.mapError(toTokenAdminError)),
              revoke: (scope, name) =>
                client.tokens
                  .remove({ params: { scope, name } })
                  .pipe(
                    Effect.mapError((error) =>
                      Schema.is(Api.TokenNotFound)(error)
                        ? error
                        : toTokenAdminError(error),
                    ),
                  ),
            });
          }),
        ).pipe(
          Layer.provide(TriageClient.layer({ url, token })),
          Layer.provide(FetchHttpClient.layer),
        );
      }),
    );
}
