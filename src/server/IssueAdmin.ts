import { Api, type Issue, TriageClient } from "@timmo001/effect-triage-client";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { FetchHttpClient } from "effect/http";
import { Redactor } from "../redact.js";
import {
  type IssueNotFound,
  type ListOptions,
  Store,
  type StoreError,
} from "../store/Store.js";
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
 * Lists, reads, labels, resolves, mutes and reopens a server's issues, notes
 * on them, and compares its decision models with the labels, here or over its
 * API. Notes are redacted with this machine's names before they're stored or
 * sent.
 */
export class IssueAdmin extends Context.Service<
  IssueAdmin,
  {
    /** The latest seen issues first, unless `options` sorts them otherwise. */
    list(
      options: ListOptions,
    ): Effect.Effect<ReadonlyArray<Api.IssueSummary>, IssueAdminError>;
    /** Resolve, mute or reopen an issue, with a note on why. */
    setStatus(
      id: string,
      status: Issue.Status,
      note?: string,
    ): Effect.Effect<void, Api.IssueNotFound | IssueAdminError>;
    addNote(
      id: string,
      text: string,
    ): Effect.Effect<void, Api.IssueNotFound | IssueAdminError>;
    setLabel(
      id: string,
      label: Api.Label,
    ): Effect.Effect<void, Api.IssueNotFound | IssueAdminError>;
    readonly agreement: Effect.Effect<
      ReadonlyArray<Api.Agreement>,
      IssueAdminError
    >;
    /** An issue with its latest events, notes and what the models made of it. */
    review(
      id: string,
    ): Effect.Effect<Api.IssueReview, Api.IssueNotFound | IssueAdminError>;
    /** A page of an issue's events, newest first. */
    events(
      id: string,
      page: { readonly limit: number; readonly offset: number },
    ): Effect.Effect<Api.IssueEvents, Api.IssueNotFound | IssueAdminError>;
    /**
     * Issues like this one, with their suggested fixes and notes, resolved
     * ones first.
     */
    similar(
      id: string,
      limit: number,
    ): Effect.Effect<
      ReadonlyArray<Api.SimilarIssue>,
      Api.IssueNotFound | IssueAdminError
    >;
  }
>()("triage/server/IssueAdmin") {
  /**
   * The issues in this machine's server database. `by` is who its notes and
   * status changes are from, such as `cli` or `mcp`.
   */
  static readonly layerLocal = (options: { readonly by: string }) =>
    Layer.effect(
      IssueAdmin,
      Effect.gen(function* () {
        const store = yield* Store;
        const { redact } = yield* Redactor;

        const notFound =
          (id: string) =>
          <A>(effect: Effect.Effect<A, IssueNotFound | StoreError>) =>
            effect.pipe(
              Effect.catchTags({
                IssueNotFound: () => Effect.fail(new Api.IssueNotFound({ id })),
                StoreError: (error) => Effect.fail(toIssueAdminError(error)),
              }),
            );

        return IssueAdmin.of({
          list: (options) =>
            store.issues(options).pipe(Effect.mapError(toIssueAdminError)),
          setStatus: (id, status, note) =>
            store
              .setStatus(id, status, {
                by: options.by,
                note: note === undefined ? undefined : redact(note),
              })
              .pipe(notFound(id)),
          addNote: (id, text) =>
            store.addNote(id, redact(text), options.by).pipe(notFound(id)),
          setLabel: (id, label) =>
            store.label(id, label === "worth").pipe(notFound(id)),
          agreement: store.labelledDecisions.pipe(
            Effect.map(agreement),
            Effect.mapError(toIssueAdminError),
          ),
          review: (id) =>
            store.review(id, Api.latestEvents).pipe(
              Effect.mapError(toIssueAdminError),
              Effect.flatMap(
                Option.match({
                  onNone: () => Effect.fail(new Api.IssueNotFound({ id })),
                  onSome: Effect.succeed,
                }),
              ),
            ),
          events: (id, page) =>
            store.events(id, page).pipe(
              Effect.mapError(toIssueAdminError),
              Effect.flatMap(
                Option.match({
                  onNone: () => Effect.fail(new Api.IssueNotFound({ id })),
                  onSome: Effect.succeed,
                }),
              ),
            ),
          similar: (id, limit) =>
            store.similar(id, limit).pipe(
              Effect.mapError(toIssueAdminError),
              Effect.flatMap(
                Option.match({
                  onNone: () => Effect.fail(new Api.IssueNotFound({ id })),
                  onSome: Effect.succeed,
                }),
              ),
            ),
        });
      }),
    ).pipe(Layer.provide(Redactor.layer));

  /** The issues of the server at `url`, as the admin in `$TRIAGE_ADMIN_TOKEN`. */
  static readonly layerRemote = (url: string) =>
    Layer.unwrap(
      Effect.gen(function* () {
        const token = yield* adminToken;

        return Layer.effect(
          IssueAdmin,
          Effect.gen(function* () {
            const client = yield* TriageClient;
            const { redact } = yield* Redactor;

            const notFound = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
              effect.pipe(
                Effect.mapError((error) =>
                  Schema.is(Api.IssueNotFound)(error)
                    ? error
                    : toIssueAdminError(error),
                ),
              );

            return IssueAdmin.of({
              list: (options) =>
                client.issues
                  .list({ query: options })
                  .pipe(Effect.mapError(toIssueAdminError)),
              setStatus: (id, status, note) =>
                client.issues
                  .setStatus({
                    params: { id },
                    payload: {
                      status,
                      ...(note !== undefined && { note: redact(note) }),
                    },
                  })
                  .pipe(notFound),
              addNote: (id, text) =>
                client.issues
                  .addNote({ params: { id }, payload: { text: redact(text) } })
                  .pipe(notFound),
              setLabel: (id, label) =>
                client.issues
                  .setLabel({ params: { id }, payload: { label } })
                  .pipe(notFound),
              agreement: client.decisions
                .agreement()
                .pipe(Effect.mapError(toIssueAdminError)),
              review: (id) =>
                client.issues.get({ params: { id } }).pipe(notFound),
              events: (id, page) =>
                client.issues
                  .events({ params: { id }, query: page })
                  .pipe(notFound),
              similar: (id, limit) =>
                client.issues
                  .similar({ params: { id }, query: { limit } })
                  .pipe(notFound),
            });
          }),
        ).pipe(
          Layer.provide(TriageClient.layer({ url, token })),
          Layer.provide(FetchHttpClient.layer),
          Layer.provide(Redactor.layer),
        );
      }),
    );
}
