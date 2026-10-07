import { Api, Event, Issue } from "@timmo001/effect-triage";
import { Effect, Schema } from "effect";
import { McpProtocol, Tool, Toolkit } from "effect/ai";
import packageJson from "../../package.json" with { type: "json" };
import { IssueAdmin } from "../server/IssueAdmin.js";

/**
 * The issue ID in `input`: a bare ID, or a link to the issue's page, such as
 * `https://triage.example.com/issues/<id>` or a Home Assistant ingress link.
 */
export const issueId = (input: string) => {
  const match = /\/issues\/([^/?#]+)/.exec(input.trim());

  return match?.[1] === undefined ? input.trim() : decodeURIComponent(match[1]);
};

export class IssueToolError extends Schema.TaggedError<IssueToolError>()(
  "IssueToolError",
  { message: Schema.String },
) {}

const IssueParameter = Schema.String.annotate({
  description:
    "The issue's ID, or a link to its page in triage's web UI, such as https://triage.example.com/issues/0123456789abcdef",
});

const defaultEventPage = 100;

const defaultIssuePage = 20;

const maxIssuePage = 100;

const defaultSimilar = 10;

const ListIssues = Tool.make("list_issues", {
  description: `Find triage issues, the latest seen first unless sorted otherwise. Each one comes with its kind, state, counts, hosts, the latest decision's worth and any hand label. Start at offset 0 and pass nextOffset back until it's missing. Read one in full with get_issue.`,
  parameters: Schema.Struct({
    search: Schema.optionalKey(Schema.String).annotate({
      description: "Only issues whose title contains this, ignoring case",
    }),
    state: Schema.optionalKey(Schema.Array(Issue.State)).annotate({
      description: "Only issues in one of these states",
    }),
    kind: Schema.optionalKey(Schema.Array(Issue.Kind)).annotate({
      description: "Only issues of one of these kinds",
    }),
    host: Schema.optionalKey(Schema.Array(Schema.String)).annotate({
      description: "Only issues that happened on one of these hosts",
    }),
    label: Schema.optionalKey(Schema.Array(Api.LabelFilter)).annotate({
      description:
        "Only issues labelled worth fixing or noise, or none for those without a label",
    }),
    sort: Schema.optionalKey(Api.IssueSort).annotate({
      description: "What to sort by, lastSeen by default",
    }),
    order: Schema.optionalKey(Api.SortOrder).annotate({
      description: "desc by default",
    }),
    offset: Schema.Int.pipe(
      Schema.withDecodingDefaultKey(Effect.succeed(0)),
    ).annotate({ description: "How many issues to skip" }),
    limit: Schema.Int.pipe(
      Schema.withDecodingDefaultKey(Effect.succeed(defaultIssuePage)),
    ).annotate({
      description: `The most issues to return, up to ${maxIssuePage}`,
    }),
  }),
  success: Schema.Struct({
    offset: Schema.Int,
    issues: Schema.Array(Api.IssueSummary),
    /** The offset of the next page, missing on the last one. */
    nextOffset: Schema.optionalKey(Schema.Int),
  }),
  failure: IssueToolError,
  failureMode: "return",
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const GetIssue = Tool.make("get_issue", {
  description: `Read a triage issue: its kind, state and counts, the hosts it happened on, what the decision models made of it, suggested fixes, and its latest ${Api.latestEvents} events, newest first. Everything personal was redacted before it was stored. issue.count is how many events it has in all; read the rest with get_issue_events.`,
  parameters: Schema.Struct({ issue: IssueParameter }),
  success: Api.IssueReview,
  failure: IssueToolError,
  failureMode: "return",
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const GetIssueEvents = Tool.make("get_issue_events", {
  description: `Read a page of a triage issue's events, newest first, to see every occurrence of it. Start at offset 0 and pass nextOffset back until it's missing.`,
  parameters: Schema.Struct({
    issue: IssueParameter,
    offset: Schema.Int.pipe(
      Schema.withDecodingDefaultKey(Effect.succeed(0)),
    ).annotate({ description: "How many of the newest events to skip" }),
    limit: Schema.Int.pipe(
      Schema.withDecodingDefaultKey(Effect.succeed(defaultEventPage)),
    ).annotate({
      description: `The most events to return, up to ${Api.maxEventPage}`,
    }),
  }),
  success: Schema.Struct({
    /** How many events the issue has in all. */
    total: Schema.Int,
    offset: Schema.Int,
    events: Schema.Array(Event.Event),
    /** The offset of the next page, missing on the last one. */
    nextOffset: Schema.optionalKey(Schema.Int),
  }),
  failure: IssueToolError,
  failureMode: "return",
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const FindSimilarIssues = Tool.make("find_similar_issues", {
  description: `Find issues like a triage issue, with the fixes suggested for each, to see what worked before. Similar means a crash of the same program with the same signal, the same unit failing, or the same error or OOM kill on another host. Resolved issues come first, then the latest seen.`,
  parameters: Schema.Struct({
    issue: IssueParameter,
    limit: Schema.Int.pipe(
      Schema.withDecodingDefaultKey(Effect.succeed(defaultSimilar)),
    ).annotate({
      description: `The most issues to return, up to ${Api.maxSimilar}`,
    }),
  }),
  success: Schema.Struct({ issues: Schema.Array(Api.SimilarIssue) }),
  failure: IssueToolError,
  failureMode: "return",
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

/** Tools for agents to find and read a server's issues and their events. */
export const IssueTools = Toolkit.make(
  ListIssues,
  GetIssue,
  GetIssueEvents,
  FindSimilarIssues,
);

const toIssueToolError = (error: { readonly message: string }) =>
  new IssueToolError({ message: error.message });

export const IssueToolsLayer = IssueTools.toLayer(
  Effect.gen(function* () {
    const admin = yield* IssueAdmin;

    return IssueTools.of({
      list_issues: Effect.fn("IssueTools.list_issues")(function* ({
        offset,
        limit,
        ...filters
      }) {
        const start = Math.max(offset, 0);
        const size = Math.min(Math.max(limit, 1), maxIssuePage);

        // One more than asked for shows whether there's another page.
        const issues = yield* admin
          .list({ ...filters, offset: start, limit: size + 1 })
          .pipe(Effect.mapError(toIssueToolError));

        return {
          offset: start,
          issues: issues.slice(0, size),
          ...(issues.length > size && { nextOffset: start + size }),
        };
      }),
      get_issue: Effect.fn("IssueTools.get_issue")(function* ({ issue }) {
        return yield* admin
          .review(issueId(issue))
          .pipe(Effect.mapError(toIssueToolError));
      }),
      get_issue_events: Effect.fn("IssueTools.get_issue_events")(function* ({
        issue,
        offset,
        limit,
      }) {
        const start = Math.max(offset, 0);

        const page = yield* admin
          .events(issueId(issue), {
            limit: Math.min(Math.max(limit, 1), Api.maxEventPage),
            offset: start,
          })
          .pipe(Effect.mapError(toIssueToolError));

        const next = start + page.events.length;

        return {
          total: page.total,
          offset: start,
          events: page.events,
          ...(page.events.length > 0 &&
            next < page.total && {
              nextOffset: next,
            }),
        };
      }),
      find_similar_issues: Effect.fn("IssueTools.find_similar_issues")(
        function* ({ issue, limit }) {
          const issues = yield* admin
            .similar(
              issueId(issue),
              Math.min(Math.max(limit, 1), Api.maxSimilar),
            )
            .pipe(Effect.mapError(toIssueToolError));

          return { issues };
        },
      ),
    });
  }),
);

/** How triage's MCP server introduces itself, over any transport. */
export const mcpOptions = {
  name: "triage",
  version: packageJson.version,
  instructions:
    "Read crashes and errors triage collected from your machines. Find issues with list_issues, or pass get_issue an issue ID or a link to the issue's page, then page through its events with get_issue_events. find_similar_issues shows how issues like it were fixed.",
  protocols: [
    McpProtocol.v2026_07_28,
    McpProtocol.v2025_11_25,
    McpProtocol.v2025_06_18,
    McpProtocol.v2025_03_26,
    McpProtocol.v2024_11_05,
  ],
} as const;
