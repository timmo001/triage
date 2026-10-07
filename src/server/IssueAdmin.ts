import { Api, type Issue, TriageClient } from "@timmo001/effect-triage-client";
import { Context, Effect, Layer, Schema } from "effect";
import { FetchHttpClient } from "effect/http";
import { Store } from "../store/Store.js";
import { agreement } from "../triage/Triager.js";
import { adminToken } from "./adminToken.js";

/** The store or the server couldn't read or change an issue. */
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

/**
 * Lists, labels, resolves, mutes and reopens a server's issues, and compares
 * its decision models with the labels, here or over its API.
 */
export class IssueAdmin extends Context.Service<
  IssueAdmin,
  {
    /** The latest seen issues first. */
    list(
      limit: number,
    ): Effect.Effect<ReadonlyArray<Api.IssueSummary>, IssueAdminError>;
    setStatus(
      id: string,
      status: Issue.Status,
    ): Effect.Effect<void, Api.IssueNotFound | IssueAdminError>;
    setLabel(
      id: string,
      label: Api.Label,
    ): Effect.Effect<void, Api.IssueNotFound | IssueAdminError>;
    readonly agreement: Effect.Effect<
      ReadonlyArray<Api.Agreement>,
      IssueAdminError
    >;
  }
>()("triage/server/IssueAdmin") {
  /** The issues in this machine's server database. */
  static readonly layerLocal = Layer.effect(
    IssueAdmin,
    Effect.gen(function* () {
      const store = yield* Store;

      return IssueAdmin.of({
        list: (limit) =>
          store.issues({ limit }).pipe(Effect.mapError(toIssueAdminError)),
        setStatus: (id, status) =>
          store.setStatus(id, status).pipe(
            Effect.catchTags({
              IssueNotFound: () => Effect.fail(new Api.IssueNotFound({ id })),
              StoreError: (error) => Effect.fail(toIssueAdminError(error)),
            }),
          ),
        setLabel: (id, label) =>
          store.label(id, label === "worth").pipe(
            Effect.catchTags({
              IssueNotFound: () => Effect.fail(new Api.IssueNotFound({ id })),
              StoreError: (error) => Effect.fail(toIssueAdminError(error)),
            }),
          ),
        agreement: store.labelledDecisions.pipe(
          Effect.map(agreement),
          Effect.mapError(toIssueAdminError),
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
              list: (limit) =>
                client.issues
                  .list({ query: { limit } })
                  .pipe(Effect.mapError(toIssueAdminError)),
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
              setLabel: (id, label) =>
                client.issues
                  .setLabel({ params: { id }, payload: { label } })
                  .pipe(
                    Effect.mapError((error) =>
                      Schema.is(Api.IssueNotFound)(error)
                        ? error
                        : toIssueAdminError(error),
                    ),
                  ),
              agreement: client.decisions
                .agreement()
                .pipe(Effect.mapError(toIssueAdminError)),
            });
          }),
        ).pipe(
          Layer.provide(TriageClient.layer({ url, token })),
          Layer.provide(FetchHttpClient.layer),
        );
      }),
    );
}
