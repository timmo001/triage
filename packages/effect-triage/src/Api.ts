import { Context, Effect, Schema } from "effect";
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
import { Issue, Kind, State, Status } from "./Issue.js";

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

/** How many of an issue's latest events come with it. */
export const latestEvents = 20;

/** The most events one page of an issue's events may hold. */
export const maxEventPage = 500;

/** A page of an issue's events, newest first. */
export const IssueEvents = Schema.Struct({
  /** How many events the issue has in all. */
  total: Schema.Int,
  events: Schema.Array(Event),
});

export interface IssueEvents extends Schema.Schema.Type<typeof IssueEvents> {}

/** How often an issue happened on one host. */
export const HostCount = Schema.Struct({
  /** The host's enrolled name. */
  host: Schema.String,
  /** How many of the issue's events came from it. */
  count: Schema.Int,
  /** When its first and latest events happened, in milliseconds since the Unix epoch. */
  firstSeen: Schema.Finite,
  lastSeen: Schema.Finite,
});

export interface HostCount extends Schema.Schema.Type<typeof HostCount> {}

/**
 * A person's verdict on an issue: worth fixing, or noise. Decision models are
 * measured against these.
 */
export const Label = Schema.Literals(["worth", "noise"]);

export type Label = typeof Label.Type;

/** An issue in a list, with the latest decision's worth when there is one. */
export const IssueSummary = Schema.Struct({
  ...Issue.fields,
  /** The probability the latest decision gave that it's worth fixing. */
  worth: Schema.optional(Schema.Finite),
  /** The hand label, when someone has given one. Older servers don't send this. */
  label: Schema.optional(Label),
  /** The hosts it happened on, by name. Older servers don't send this. */
  hosts: Schema.Array(Schema.String).pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed([])),
  ),
});

export interface IssueSummary extends Schema.Schema.Type<typeof IssueSummary> {}

/** What an issue list can be sorted by. */
export const IssueSort = Schema.Literals([
  "lastSeen",
  "firstSeen",
  "worth",
  "count",
  "title",
]);

export type IssueSort = typeof IssueSort.Type;

export const SortOrder = Schema.Literals(["asc", "desc"]);

export type SortOrder = typeof SortOrder.Type;

/** What an issue list can keep together. */
export const IssueGrouping = Schema.Literals(["state", "kind", "label"]);

export type IssueGrouping = typeof IssueGrouping.Type;

/** Issues with this label, or `none` for those without one. */
export const LabelFilter = Schema.Literals(["worth", "noise", "none"]);

export type LabelFilter = typeof LabelFilter.Type;

/** Filters shared by an issue list and its counts. Lists match any value. */
export const IssueFilters = Schema.Struct({
  /** Only issues that happened on one of these hosts. */
  host: Schema.optional(Schema.Array(Schema.String)),
  kind: Schema.optional(Schema.Array(Kind)),
  label: Schema.optional(Schema.Array(LabelFilter)),
  /** Only issues whose title contains this, ignoring case. */
  search: Schema.optional(Schema.String),
});

export interface IssueFilters extends Schema.Schema.Type<typeof IssueFilters> {}

/** How many issues match the filters, in all and in each state. */
export const IssueCounts = Schema.Struct({
  total: Schema.Int,
  states: Schema.Record(State, Schema.Int),
});

export interface IssueCounts extends Schema.Schema.Type<typeof IssueCounts> {}

/** A host that has sent events, and how much. */
export const HostSummary = Schema.Struct({
  /** The host's enrolled name. */
  host: Schema.String,
  /** How many events it has sent. */
  events: Schema.Int,
  /** How many issues those events belong to. */
  issues: Schema.Int,
  /** When its latest event happened, in milliseconds since the Unix epoch. */
  lastSeen: Schema.Finite,
});

export interface HostSummary extends Schema.Schema.Type<typeof HostSummary> {}

/** What a decision model last made of an issue, for people to read. */
export const IssueDecision = Schema.Struct({
  /** The model, as `provider/model`. */
  model: Schema.String,
  /** When it decided, in milliseconds since the Unix epoch. */
  decidedAt: Schema.Finite,
  /**
   * The worker that asked the model, or `server` or `cli`. Null for
   * decisions from before 0.5.0.
   */
  by: Schema.NullOr(Schema.String),
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
  /**
   * The worker that asked the model, or `server` or `cli`. Null for
   * suggestions from before 0.5.0.
   */
  by: Schema.NullOr(Schema.String),
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
  /** The hand label, when someone has given one. */
  label: Schema.optional(Label),
  /**
   * How often it happened on each host, most events first. Older servers
   * don't send this.
   */
  hosts: Schema.Array(HostCount).pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed([])),
  ),
});

export interface IssueReview extends Schema.Schema.Type<typeof IssueReview> {}

/** An issue like another one, with the fixes suggested for it. */
export const SimilarIssue = Schema.Struct({
  ...IssueSummary.fields,
  /** Each model's latest suggestion, newest first. */
  suggestions: Schema.Array(IssueSuggestion),
});

export interface SimilarIssue extends Schema.Schema.Type<typeof SimilarIssue> {}

/** The most similar issues one request returns. */
export const maxSimilar = 50;

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

/** How a decision model's decisions compare with hand labels. */
export const Agreement = Schema.Struct({
  /** The model, as `provider/model`. */
  model: Schema.String,
  /** Labelled issues the model decided on. */
  labelled: Schema.Int,
  /** Decisions sure enough to act on either way. */
  clear: Schema.Int,
  /** Clear decisions that match the label. */
  correct: Schema.Int,
});

export interface Agreement extends Schema.Schema.Type<typeof Agreement> {}

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
        /** How many issues to skip, for fetching the next page. */
        offset: Schema.optional(Schema.Int),
        ...IssueFilters.fields,
        /** Only issues in one of these states. */
        state: Schema.optional(Schema.Array(State)),
        /** What to sort by. The latest seen first by default. */
        sort: Schema.optional(IssueSort),
        order: Schema.optional(SortOrder),
        /** Keep issues with the same value together, before sorting. */
        group: Schema.optional(IssueGrouping),
      },
      success: Schema.Array(IssueSummary),
    }),
    HttpApiEndpoint.get("counts", "/counts", {
      query: IssueFilters.fields,
      success: IssueCounts,
    }),
    HttpApiEndpoint.get("get", "/:id", {
      params: { id: Schema.String },
      success: IssueReview,
      error: IssueNotFound,
    }),
    HttpApiEndpoint.get("events", "/:id/events", {
      params: { id: Schema.String },
      query: {
        limit: Schema.optional(Schema.Int),
        /** How many of the newest events to skip, for fetching the next page. */
        offset: Schema.optional(Schema.Int),
      },
      success: IssueEvents,
      error: IssueNotFound,
    }),
    HttpApiEndpoint.get("similar", "/:id/similar", {
      params: { id: Schema.String },
      query: { limit: Schema.optional(Schema.Int) },
      success: Schema.Array(SimilarIssue),
      error: IssueNotFound,
    }),
    HttpApiEndpoint.put("setStatus", "/:id/status", {
      params: { id: Schema.String },
      payload: Schema.Struct({ status: Status }),
      success: HttpApiSchema.NoContent,
      error: IssueNotFound,
    }),
    HttpApiEndpoint.put("setLabel", "/:id/label", {
      params: { id: Schema.String },
      payload: Schema.Struct({ label: Label }),
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
        "Events grouped by fingerprint, similar issues and their suggested fixes, resolving or muting them, and labelling them worth fixing or noise",
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

export class HostsGroup extends HttpApiGroup.make("hosts")
  .add(
    HttpApiEndpoint.get("list", "/", {
      success: Schema.Array(HostSummary),
    }),
  )
  .middleware(AdminAuthorization)
  .prefix("/api/hosts")
  .annotateMerge(
    OpenApi.annotations({
      title: "Hosts",
      description: "Every host that has sent events, most recently seen first",
    }),
  ) {}

export class DecisionsGroup extends HttpApiGroup.make("decisions")
  .add(
    HttpApiEndpoint.get("agreement", "/agreement", {
      success: Schema.Array(Agreement),
    }),
  )
  .middleware(AdminAuthorization)
  .prefix("/api/decisions")
  .annotateMerge(
    OpenApi.annotations({
      title: "Decisions",
      description:
        "How each decision model compares with the hand labels: how often it's sure enough to act on, and how often it's right when it is",
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
  .add(HostsGroup)
  .add(WorkGroup)
  .add(DecisionsGroup)
  .add(TokensGroup)
  .add(SystemGroup)
  .annotateMerge(OpenApi.annotations({ title: "triage" })) {}
