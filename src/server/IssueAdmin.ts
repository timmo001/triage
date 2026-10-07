import { Api, type Issue, TriageClient } from "@timmo001/effect-triage-client";
import { Context, Effect, Layer, Schema } from "effect";
import { FetchHttpClient } from "effect/http";
import { Store } from "../store/Store.js";
import { adminToken } from "./adminToken.js";

/** The store or the server couldn't change an issue. */
export class IssueAdminError extends Schema.TaggedError<IssueAdminError>()(
  "IssueAdminError",
  { cause: Schema.Defect() },
) {
  override get message() {
    return this.cause instanceof Error
      ? this.cause.message
      : String(this.cause);
  }
}

const toIssueAdminError = (cause: unknown) => new IssueAdminError({ cause });

/** Resolves, mutes and reopens a server's issues, here or over its API. */
export class IssueAdmin extends Context.Service<
  IssueAdmin,
  {
    setStatus(
      id: string,
      status: Issue.Status,
    ): Effect.Effect<void, Api.IssueNotFound | IssueAdminError>;
  }
>()("triage/server/IssueAdmin") {
  /** The issues in this machine's server database. */
  static readonly layerLocal = Layer.effect(
    IssueAdmin,
    Effect.gen(function* () {
      const store = yield* Store;

      return IssueAdmin.of({
        setStatus: (id, status) =>
          store.setStatus(id, status).pipe(
            Effect.catchTags({
              IssueNotFound: () => Effect.fail(new Api.IssueNotFound({ id })),
              StoreError: (error) => Effect.fail(toIssueAdminError(error)),
            }),
          ),
      });
    }),
  );

  /** The issues of the server at `url`, as the admin in `$TRIAGE_ADMIN_TOKEN`. */
  static readonly layerRemote = (url: string) =>
    Layer.unwrap(
      Effect.gen(function* () {
        const token = yield* adminToken;

        return Layer.effect(
          IssueAdmin,
          Effect.gen(function* () {
            const client = yield* TriageClient;

            return IssueAdmin.of({
              setStatus: (id, status) =>
                client.issues
                  .setStatus({ params: { id }, payload: { status } })
                  .pipe(
                    Effect.mapError((error) =>
                      Schema.is(Api.IssueNotFound)(error)
                        ? error
                        : toIssueAdminError(error),
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
