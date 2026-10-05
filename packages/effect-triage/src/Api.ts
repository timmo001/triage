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
import { Issue } from "./Issue.js";

/** The enrolled host a request was authenticated as. */
export class CurrentHost extends Context.Service<
  CurrentHost,
  { readonly name: string }
>()("@timmo001/effect-triage/Api/CurrentHost") {}

export class Unauthorized extends Schema.TaggedError<Unauthorized>()(
  "Unauthorized",
  { message: Schema.String },
  { httpApiStatus: 401 },
) {}

export class IssueNotFound extends Schema.TaggedError<IssueNotFound>()(
  "IssueNotFound",
  { id: Schema.String },
  { httpApiStatus: 404 },
) {}

/** Authenticates a host by the bearer token it was given on enrolment. */
export class Authorization extends HttpApiMiddleware.Service<
  Authorization,
  { provides: CurrentHost; requires: never }
>()("@timmo001/effect-triage/Api/Authorization", {
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
  .middleware(Authorization)
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
      success: Schema.Array(Issue),
    }),
    HttpApiEndpoint.get("get", "/:id", {
      params: { id: Schema.String },
      success: IssueDetail,
      error: IssueNotFound,
    }),
  )
  .middleware(Authorization)
  .prefix("/api/issues")
  .annotateMerge(
    OpenApi.annotations({
      title: "Issues",
      description: "Events grouped by fingerprint",
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
  .add(SystemGroup)
  .annotateMerge(OpenApi.annotations({ title: "triage" })) {}
