import { Api, Event } from "@timmo001/effect-triage";
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

/** Tools for agents to read a server's issues and their events. */
export const IssueTools = Toolkit.make(GetIssue, GetIssueEvents);

const toIssueToolError = (error: { readonly message: string }) =>
  new IssueToolError({ message: error.message });

export const IssueToolsLayer = IssueTools.toLayer(
  Effect.gen(function* () {
    const admin = yield* IssueAdmin;

    return IssueTools.of({
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
    });
  }),
);

/** How triage's MCP server introduces itself, over any transport. */
export const mcpOptions = {
  name: "triage",
  version: packageJson.version,
  instructions:
    "Read crashes and errors triage collected from your machines. Pass get_issue an issue ID or a link to the issue's page, then page through its events with get_issue_events.",
  protocols: [
    McpProtocol.v2026_07_28,
    McpProtocol.v2025_11_25,
    McpProtocol.v2025_06_18,
    McpProtocol.v2025_03_26,
    McpProtocol.v2024_11_05,
  ],
} as const;
