import { Context, Schema } from "effect";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSchema,
  HttpApiSecurity,
  OpenApi,
} from "effect/http-api";
import { Event } from "./Event.js";
import { Issue, Status } from "./Issue.js";

/** The enrolled host a request was authenticated as. */
export class CurrentHost extends Context.Service<
  CurrentHost,
  { readonly name: string }
>()("@timmo001/effect-triage/Api/CurrentHost") {}

/** The admin a request was authenticated as. */
export class CurrentAdmin extends Context.Service<
  CurrentAdmin,
  { readonly name: string }
>()("@timmo001/effect-triage/Api/CurrentAdmin") {}

/** The worker a request was authenticated as. */
export class CurrentWorker extends Context.Service<
  CurrentWorker,
  { readonly name: string }
>()("@timmo001/effect-triage/Api/CurrentWorker") {}

export class Unauthorized extends Schema.TaggedError<Unauthorized>()(
  "Unauthorized",
  { message: Schema.String },
  { httpApiStatus: 401 },
) {}

export class IssueNotFound extends Schema.TaggedError<IssueNotFound>()(
  "IssueNotFound",
  { id: Schema.String },
  { httpApiStatus: 404 },
) {
  override get message() {
    return `There's no issue ${this.id}`;
  }
}

/**
 * What a token can do: a host uploads events, an admin reads issues and
 * manages tokens, and a worker decides on issues or suggests fixes for them.
 */
export const TokenScope = Schema.Literals(["host", "admin", "worker"]);

export type TokenScope = typeof TokenScope.Type;

/**
 * A token's name. For a host or worker it's what the server knows it by, in
 * place of its real hostname, so choose something that doesn't identify the
 * machine.
 */
export const TokenName = Schema.String.check(
  Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,62}$/),
);

/** A token's owner. The token itself is only shown when it's issued. */
export const Token = Schema.Struct({
  name: Schema.String,
  createdAt: Schema.Finite,
});

export interface Token extends Schema.Schema.Type<typeof Token> {}

export class TokenExists extends Schema.TaggedError<TokenExists>()(
  "TokenExists",
  { scope: TokenScope, owner: Schema.String },
  { httpApiStatus: 409 },
) {
  override get message() {
    return `There's already a ${this.scope} called ${this.owner}`;
  }
}

export class TokenNotFound extends Schema.TaggedError<TokenNotFound>()(
  "TokenNotFound",
  { scope: TokenScope, owner: Schema.String },
  { httpApiStatus: 404 },
) {
  override get message() {
    return `There's no ${this.scope} called ${this.owner}`;
  }
}

/**
 * Authenticates a host by the bearer token it was given on enrolment. Host
 * tokens can only upload events.
 */
export class HostAuthorization extends HttpApiMiddleware.Service<
  HostAuthorization,
  { provides: CurrentHost; requires: never }
>()("@timmo001/effect-triage/Api/HostAuthorization", {
  requiredForClient: true,
  security: { bearer: HttpApiSecurity.bearer },
  error: Unauthorized,
}) {}

/** Authenticates an admin by bearer token, for reading issues and managing tokens. */
export class AdminAuthorization extends HttpApiMiddleware.Service<
  AdminAuthorization,
  { provides: CurrentAdmin; requires: never }
>()("@timmo001/effect-triage/Api/AdminAuthorization", {
  requiredForClient: true,
  security: { bearer: HttpApiSecurity.bearer },
  error: Unauthorized,
}) {}

/**
 * Authenticates a worker by bearer token. Workers are devices that decide on
 * issues or suggest fixes for the server; they can only fetch that work and
 * send back the answers.
 */
export class WorkerAuthorization extends HttpApiMiddleware.Service<
  WorkerAuthorization,
  { provides: CurrentWorker; requires: never }
>()("@timmo001/effect-triage/Api/WorkerAuthorization", {
  requiredForClient: true,
  security: { bearer: HttpApiSecurity.bearer },
  error: Unauthorized,
}) {}

/** The most events one ingest request may carry. */
export const maxBatch = 1000;

export const IngestResult = Schema.Struct({
  /** Events stored for the first time. */
  added: Schema.Int,
});

export interface IngestResult extends Schema.Schema.Type<typeof IngestResult> {}

export const IssueDetail = Schema.Struct({
  issue: Issue,
  /** The latest events, newest first. */
  events: Schema.Array(Event),
});

export interface IssueDetail extends Schema.Schema.Type<typeof IssueDetail> {}

/** An issue in a list, with the latest decision's worth when there is one. */
export const IssueSummary = Schema.Struct({
  ...Issue.fields,
  /** The probability the latest decision gave that it's worth fixing. */
  worth: Schema.optional(Schema.Finite),
});

export interface IssueSummary extends Schema.Schema.Type<typeof IssueSummary> {}

/** What a decision model last made of an issue, for people to read. */
export const IssueDecision = Schema.Struct({
  /** The model, as `provider/model`. */
  model: Schema.String,
  /** When it decided, in milliseconds since the Unix epoch. */
  decidedAt: Schema.Finite,
  /** How many events the issue had when the model decided. */
  issueCount: Schema.Int,
  /** The probability that the issue is worth fixing. */
  worth: Schema.Finite,
  /** The expected severity level, from 0 (none) to 3 (critical). */
  severity: Schema.Finite,
  /** The most likely cause. */
  cause: Schema.String,
});

export interface IssueDecision extends Schema.Schema.Type<
  typeof IssueDecision
> {}

/** A language model's latest suggestion for fixing an issue. */
export const IssueSuggestion = Schema.Struct({
  /** The model, as `provider/model`. */
  model: Schema.String,
  /** When it suggested, in milliseconds since the Unix epoch. */
  suggestedAt: Schema.Finite,
  /** How many events the issue had when the model wrote it. */
  issueCount: Schema.Int,
  /** The suggestion, in Markdown. */
  text: Schema.String,
});

export interface IssueSuggestion extends Schema.Schema.Type<
  typeof IssueSuggestion
> {}

/** An issue with its latest events and what the models made of it. */
export const IssueReview = Schema.Struct({
  ...IssueDetail.fields,
  /** Each model's latest decision, newest first. */
  decisions: Schema.Array(IssueDecision),
  /** Each model's latest suggestion, newest first. */
  suggestions: Schema.Array(IssueSuggestion),
});

export interface IssueReview extends Schema.Schema.Type<typeof IssueReview> {}

/** The most issues one request for work returns. */
export const maxWork = 50;

/** What a decision model made of an issue. */
export const Decision = Schema.Struct({
  issueId: Schema.String,
  /** The model, as `provider/model`. */
  model: Schema.String,
  /** How many events the issue had when the model decided. */
  issueCount: Schema.Int,
  /** The probability that the issue is worth fixing. */
  worth: Schema.Finite,
  /** The expected severity level, from 0 (none) to 3 (critical). */
  severity: Schema.Finite,
  /** The most likely cause. */
  cause: Schema.String,
  /** Every answer with its probabilities, as JSON. */
  answers: Schema.String,
});

export interface Decision extends Schema.Schema.Type<typeof Decision> {}

/** A language model's suggestion for fixing an issue. */
export const Suggestion = Schema.Struct({
  issueId: Schema.String,
  /** The model, as `provider/model`. */
  model: Schema.String,
  /** How many events the issue had when the model wrote it. */
  issueCount: Schema.Int,
  /** The suggestion, in Markdown. */
  text: Schema.String,
  /** The events the model was given, as JSON `{ host, id }` pairs. */
  evidence: Schema.String,
});

export interface Suggestion extends Schema.Schema.Type<typeof Suggestion> {}

export class IngestGroup extends HttpApiGroup.make("ingest")
  .add(
    HttpApiEndpoint.post("events", "/events", {
      payload: Schema.Struct({
        events: Schema.Array(Event).pipe(
          Schema.check(Schema.isMaxLength(maxBatch)),
        ),
      }),
      success: IngestResult,
    }),
  )
  .middleware(HostAuthorization)
  .prefix("/api")
  .annotateMerge(
    OpenApi.annotations({
      title: "Ingest",
      description: "Events sent by enrolled hosts",
    }),
  ) {}

export class IssuesGroup extends HttpApiGroup.make("issues")
  .add(
    HttpApiEndpoint.get("list", "/", {
      query: {
        limit: Schema.optional(Schema.Int),
      },
      success: Schema.Array(IssueSummary),
    }),
    HttpApiEndpoint.get("get", "/:id", {
      params: { id: Schema.String },
      success: IssueReview,
      error: IssueNotFound,
    }),
    HttpApiEndpoint.put("setStatus", "/:id/status", {
      params: { id: Schema.String },
      payload: Schema.Struct({ status: Status }),
      success: HttpApiSchema.NoContent,
      error: IssueNotFound,
    }),
  )
  .middleware(AdminAuthorization)
  .prefix("/api/issues")
  .annotateMerge(
    OpenApi.annotations({
      title: "Issues",
      description:
        "Events grouped by fingerprint, and resolving or muting them",
    }),
  ) {}

export class WorkGroup extends HttpApiGroup.make("work")
  .add(
    HttpApiEndpoint.get("toDecide", "/decide", {
      query: {
        model: Schema.String,
        limit: Schema.optional(Schema.Int),
      },
      success: Schema.Array(IssueDetail),
    }),
    HttpApiEndpoint.post("saveDecision", "/decisions", {
      payload: Decision,
      success: HttpApiSchema.NoContent,
    }),
    HttpApiEndpoint.get("toSuggest", "/suggest", {
      query: {
        model: Schema.String,
        decisionModel: Schema.String,
        worth: Schema.Finite,
        limit: Schema.optional(Schema.Int),
      },
      success: Schema.Array(IssueDetail),
    }),
    HttpApiEndpoint.get("issue", "/issues/:id", {
      params: { id: Schema.String },
      success: IssueDetail,
      error: IssueNotFound,
    }),
    HttpApiEndpoint.post("saveSuggestion", "/suggestions", {
      payload: Suggestion,
      success: HttpApiSchema.NoContent,
    }),
  )
  .middleware(WorkerAuthorization)
  .prefix("/api/work")
  .annotateMerge(
    OpenApi.annotations({
      title: "Work",
      description:
        "Issues for workers to decide on or suggest fixes for, within the server's daily limits, and their answers",
    }),
  ) {}

export class TokensGroup extends HttpApiGroup.make("tokens")
  .add(
    HttpApiEndpoint.get("list", "/:scope", {
      params: { scope: TokenScope },
      success: Schema.Array(Token),
    }),
    HttpApiEndpoint.post("add", "/:scope", {
      params: { scope: TokenScope },
      payload: Schema.Struct({ name: TokenName }),
      success: Schema.Struct({
        /** The new token, which is never shown again. */
        token: Schema.String,
      }),
      error: TokenExists,
    }),
    HttpApiEndpoint.delete("remove", "/:scope/:name", {
      params: { scope: TokenScope, name: Schema.String },
      success: HttpApiSchema.NoContent,
      error: TokenNotFound,
    }),
  )
  .middleware(AdminAuthorization)
  .prefix("/api/tokens")
  .annotateMerge(
    OpenApi.annotations({
      title: "Tokens",
      description:
        "Add, list and revoke the tokens hosts, admins and workers use",
    }),
  ) {}

export class SystemGroup extends HttpApiGroup.make("system").add(
  HttpApiEndpoint.get("health", "/api/health", {
    success: HttpApiSchema.NoContent,
  }),
) {}

/** The triage server's HTTP API, shared by the server and its clients. */
export class Api extends HttpApi.make("triage")
  .add(IngestGroup)
  .add(IssuesGroup)
  .add(WorkGroup)
  .add(TokensGroup)
  .add(SystemGroup)
  .annotateMerge(OpenApi.annotations({ title: "triage" })) {}
