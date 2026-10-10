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
import { Warning } from "./Warning.js";

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

export class NothingToMerge extends Schema.TaggedError<NothingToMerge>()(
  "NothingToMerge",
  { ids: Schema.Array(Schema.String) },
  { httpApiStatus: 400 },
) {
  override get message() {
    return "Pick at least two different issues to merge";
  }
}

export class FingerprintNotFound extends Schema.TaggedError<FingerprintNotFound>()(
  "FingerprintNotFound",
  { id: Schema.String, fingerprint: Schema.String },
  { httpApiStatus: 404 },
) {
  override get message() {
    return `Issue ${this.id} has no fingerprint ${this.fingerprint}`;
  }
}

export class NothingToUnmerge extends Schema.TaggedError<NothingToUnmerge>()(
  "NothingToUnmerge",
  { id: Schema.String },
  { httpApiStatus: 400 },
) {
  override get message() {
    return `Issue ${this.id} has only one fingerprint, so there's nothing to unmerge`;
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

/** A redaction token, such as `<ip:71d0a3c2e94b>`, and the value behind it. */
export const Redaction = Schema.Struct({
  token: Schema.String,
  /** What it is, such as `ip`, `device` or `user`. */
  kind: Schema.String,
  value: Schema.String,
});

export interface Redaction extends Schema.Schema.Type<typeof Redaction> {}

/** The most tokens looked up at once. */
export const maxTokens = 500;

/** A warning the program behind an issue logged on one host, across boots. */
export const IssueWarning = Schema.Struct({
  /** The host's enrolled name. */
  host: Schema.String,
  /** The redacted message with the parts that change replaced. */
  template: Schema.String,
  /** The latest redacted message. */
  example: Schema.String,
  count: Schema.Int,
  /** When the first and latest were logged, in milliseconds since the Unix epoch. */
  firstSeen: Schema.Finite,
  lastSeen: Schema.Finite,
});

export interface IssueWarning extends Schema.Schema.Type<typeof IssueWarning> {}

/** The most warnings that come with an issue. */
export const maxIssueWarnings = 20;

export const IssueDetail = Schema.Struct({
  issue: Issue,
  /** The latest events, newest first. */
  events: Schema.Array(Event),
  /**
   * The most frequent warnings the issue's program logged on the hosts it
   * happened on, most first. Older servers don't send these.
   */
  warnings: Schema.Array(IssueWarning).pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed([])),
  ),
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

/** The longest note, in characters. */
export const maxNote = 10_000;

/** A note's text, in Markdown, with something other than whitespace in it. */
export const NoteText = Schema.String.check(
  Schema.isMaxLength(maxNote),
  Schema.isPattern(/\S/),
);

/**
 * What happened with a note: the status someone set the issue to, or
 * `regressed` when an event reopened it.
 */
export const NoteStatus = Schema.Literals([...Status.literals, "regressed"]);

export type NoteStatus = typeof NoteStatus.Type;

/**
 * A note on an issue, such as why it was resolved, or a change to its status
 * with or without one.
 */
export const IssueNote = Schema.Struct({
  id: Schema.Int,
  /** When it was written, in milliseconds since the Unix epoch. */
  createdAt: Schema.Finite,
  /**
   * The admin who wrote it, or `cli` or `mcp` on the server's own machine.
   * For a regression, the host whose event reopened the issue. Null for
   * resolutions and regressions from before notes.
   */
  by: Schema.NullOr(Schema.String),
  /** The status change it came with, or null for a note on its own. */
  status: Schema.NullOr(NoteStatus),
  /** The note, in Markdown, redacted like events. Empty for a status change without one. */
  text: Schema.String,
});

export interface IssueNote extends Schema.Schema.Type<typeof IssueNote> {}

/** Older servers don't send notes. */
const notes = Schema.Array(IssueNote).pipe(
  Schema.withDecodingDefaultTypeKey(Effect.succeed([])),
);

/** A fingerprint an issue owns, and how many of its events have it. */
export const IssueFingerprint = Schema.Struct({
  fingerprint: Schema.String,
  count: Schema.Int,
});

export interface IssueFingerprint extends Schema.Schema.Type<
  typeof IssueFingerprint
> {}

/** The issue that issues were merged into, and the IDs that now lead to it. */
export const Merged = Schema.Struct({
  id: Schema.String,
  merged: Schema.Array(Schema.String),
});

export interface Merged extends Schema.Schema.Type<typeof Merged> {}

/**
 * How close another issue's event must be, before or after one of an issue's
 * latest events on the same host, to count as around the same time, in
 * milliseconds.
 */
export const nearbyMillis = 60_000;

/** The most issues that come with an issue as happening around the same time. */
export const maxNearby = 10;

/**
 * Another issue that happened on the same host around the same time as an
 * issue's latest events, which may share a cause, such as a network or device
 * going down.
 */
export const NearbyIssue = Schema.Struct({
  ...IssueSummary.fields,
  /** How many of the issue's latest events it happened around. */
  near: Schema.Int,
});

export interface NearbyIssue extends Schema.Schema.Type<typeof NearbyIssue> {}

/** An issue with its latest events and what the models made of it. */
export const IssueReview = Schema.Struct({
  ...IssueDetail.fields,
  /** Each model's latest decision, newest first. */
  decisions: Schema.Array(IssueDecision),
  /** Each model's latest suggestion, newest first. */
  suggestions: Schema.Array(IssueSuggestion),
  /** Notes and status changes, newest first. */
  notes,
  /** The hand label, when someone has given one. */
  label: Schema.optional(Label),
  /**
   * How often it happened on each host, most events first. Older servers
   * don't send this.
   */
  hosts: Schema.Array(HostCount).pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed([])),
  ),
  /**
   * The fingerprints it owns, most events first: more than one once issues
   * are merged into it. Older servers don't send this.
   */
  fingerprints: Schema.Array(IssueFingerprint).pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed([])),
  ),
  /**
   * Other issues that happened on the same hosts within {@link nearbyMillis}
   * of its latest events, those near the most first. Older servers don't send
   * this.
   */
  nearby: Schema.Array(NearbyIssue).pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed([])),
  ),
});

export interface IssueReview extends Schema.Schema.Type<typeof IssueReview> {}

/** An issue like another one, with the fixes suggested for it. */
export const SimilarIssue = Schema.Struct({
  ...IssueSummary.fields,
  /** Each model's latest suggestion, newest first. */
  suggestions: Schema.Array(IssueSuggestion),
  /** Notes and status changes, newest first, such as how it was fixed. */
  notes,
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
    /**
     * Warning counts, each replacing the last one sent for its boot. Only
     * those for a program with an issue that isn't muted are kept, and
     * `added` is how many were.
     */
    HttpApiEndpoint.post("warnings", "/warnings", {
      payload: Schema.Struct({
        warnings: Schema.Array(Warning).pipe(
          Schema.check(Schema.isMaxLength(maxBatch)),
        ),
      }),
      success: IngestResult,
    }),
    /**
     * The values behind a host's redaction tokens, which hosts only send to
     * a server on their own network when told to. The first value for each
     * token is kept, and `added` is how many were new.
     */
    HttpApiEndpoint.post("redactions", "/redactions", {
      payload: Schema.Struct({
        redactions: Schema.Array(Redaction).pipe(
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
      description: "Events and warning counts sent by enrolled hosts",
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
      payload: Schema.Struct({
        status: Status,
        /** Why, such as what fixed it, kept in the issue's notes. */
        note: Schema.optional(NoteText),
      }),
      success: HttpApiSchema.NoContent,
      error: IssueNotFound,
    }),
    HttpApiEndpoint.post("addNote", "/:id/notes", {
      params: { id: Schema.String },
      payload: Schema.Struct({ text: NoteText }),
      success: HttpApiSchema.NoContent,
      error: IssueNotFound,
    }),
    HttpApiEndpoint.put("setLabel", "/:id/label", {
      params: { id: Schema.String },
      payload: Schema.Struct({ label: Label }),
      success: HttpApiSchema.NoContent,
      error: IssueNotFound,
    }),
    /**
     * Merge issues into one: the issue seen first is kept, then the one with
     * more events, then the lower ID. The others' IDs lead to it.
     */
    HttpApiEndpoint.post("merge", "/merge", {
      payload: Schema.Struct({ ids: Schema.Array(Schema.String) }),
      success: Merged,
      error: [IssueNotFound, NothingToMerge],
    }),
    /** Move a fingerprint's events out into an issue of their own, returning its ID. */
    HttpApiEndpoint.post("unmerge", "/:id/unmerge", {
      params: { id: Schema.String },
      payload: Schema.Struct({ fingerprint: Schema.String }),
      success: Schema.Struct({ id: Schema.String }),
      error: [IssueNotFound, FingerprintNotFound, NothingToUnmerge],
    }),
  )
  .middleware(AdminAuthorization)
  .prefix("/api/issues")
  .annotateMerge(
    OpenApi.annotations({
      title: "Issues",
      description:
        "Events grouped by fingerprint, similar issues and their suggested fixes, resolving or muting them, notes on them, labelling them worth fixing or noise, and merging and unmerging them",
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

/**
 * How the server's own collection of Home Assistant's errors, such as Core's
 * and the Supervisor's, is going: `collecting`, or `noJournal` when the host
 * journal isn't mounted.
 */
export const HomeAssistantCollection = Schema.Literals([
  "collecting",
  "noJournal",
]);

export type HomeAssistantCollection = typeof HomeAssistantCollection.Type;

/** What the server collects itself, rather than from enrolled hosts. */
export const Collection = Schema.Struct({
  /** Home Assistant's errors, when the server collects them. */
  homeAssistant: Schema.optionalKey(HomeAssistantCollection),
});

export interface Collection extends Schema.Schema.Type<typeof Collection> {}

export class HostsGroup extends HttpApiGroup.make("hosts")
  .add(
    HttpApiEndpoint.get("list", "/", {
      success: Schema.Array(HostSummary),
    }),
  )
  .add(
    HttpApiEndpoint.get("collection", "/collection", {
      success: Collection,
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

export class RedactionsGroup extends HttpApiGroup.make("redactions")
  .add(
    /**
     * The values behind redaction tokens that this server captured itself,
     * leaving out any it doesn't know. Only answered for someone looking at
     * the web UI through Home Assistant: anywhere else, it's empty, so an
     * agent with an admin token can't use it.
     */
    HttpApiEndpoint.post("resolve", "/resolve", {
      payload: Schema.Struct({
        tokens: Schema.Array(Schema.String).pipe(
          Schema.check(Schema.isMaxLength(maxTokens)),
        ),
      }),
      success: Schema.Array(Redaction),
    }),
  )
  .middleware(AdminAuthorization)
  .prefix("/api/redactions")
  .annotateMerge(
    OpenApi.annotations({
      title: "Redactions",
      description:
        "The values behind redaction tokens, for showing them in the web UI through Home Assistant",
    }),
  ) {}

/** The forms a plural message can take, as `Intl.PluralRules` names them. */
export const PluralForm = Schema.Literals([
  "zero",
  "one",
  "two",
  "few",
  "many",
  "other",
]);

export type PluralForm = typeof PluralForm.Type;

/**
 * A web UI message: text with `{name}` placeholders, or text for each plural
 * form the language uses, picked by the `count` placeholder.
 */
export const Message = Schema.Union([
  Schema.String,
  Schema.Struct({
    zero: Schema.optionalKey(Schema.String),
    one: Schema.optionalKey(Schema.String),
    two: Schema.optionalKey(Schema.String),
    few: Schema.optionalKey(Schema.String),
    many: Schema.optionalKey(Schema.String),
    other: Schema.String,
  }),
]);

export type Message = typeof Message.Type;

/** The web UI's text in the language the server is set to. */
export const Translations = Schema.Struct({
  /** A BCP 47 language tag, such as `en` or `pt-BR`. */
  language: Schema.String,
  messages: Schema.Record(Schema.String, Message),
});

export interface Translations extends Schema.Schema.Type<typeof Translations> {}

export class SystemGroup extends HttpApiGroup.make("system")
  .add(
    HttpApiEndpoint.get("health", "/api/health", {
      success: HttpApiSchema.NoContent,
    }),
  )
  .add(
    HttpApiEndpoint.get("translations", "/api/translations", {
      success: Translations,
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
  .add(RedactionsGroup)
  .add(SystemGroup)
  .annotateMerge(OpenApi.annotations({ title: "triage" })) {}
