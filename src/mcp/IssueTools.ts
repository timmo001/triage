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
  description: `Read a triage issue: its kind, state and counts, the hosts it happened on, what the decision models made of it, suggested fixes, its notes and status history, the fingerprints it owns, more than one once issues are merged into it, and its latest ${Api.latestEvents} events, newest first. The notes say why it was resolved or muted before, and which host's event made it regress, so read them before fixing it again. Everything personal was redacted before it was stored. issue.count is how many events it has in all; read the rest with get_issue_events.`,
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
  description: `Find issues like a triage issue, with the fixes suggested for each and their notes, to see what worked before. Similar means a crash of the same program with the same signal, the same unit failing, another error from the same program, or another OOM kill. Resolved issues come first, then the latest seen.`,
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

const NoteParameter = Api.NoteText.annotate({
  description:
    "In Markdown. Say what fixed it and where: the change, commit, package or version, and the hosts it's in place on, or why it's muted, so if it comes back on another host anyone can check whether that fix reached it or it's a different case. Redacted like events",
});

const SetIssueStatus = Tool.make("set_issue_status", {
  description: `Resolve, mute or reopen a triage issue, like its page's buttons, with a note on why. Resolve it once it's fixed on every host in get_issue's hosts, after asking the user: if it happens again it opens as regressed. Mute it to stop decision and language models looking at it however often it happens. Reopen a resolved or muted issue with open.`,
  parameters: Schema.Struct({
    issue: IssueParameter,
    status: Issue.Status.annotate({
      description: "resolved, muted, or open to reopen it",
    }),
    note: Schema.optionalKey(NoteParameter),
  }),
  success: Schema.Struct({ id: Schema.String, status: Issue.Status }),
  failure: IssueToolError,
  failureMode: "return",
})
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

const AddIssueNote = Tool.make("add_issue_note", {
  description: `Add a note to a triage issue without changing its status, such as what you found, a fix that's in progress, or which hosts have it so far. Its notes show on its page and in get_issue.`,
  parameters: Schema.Struct({
    issue: IssueParameter,
    text: NoteParameter,
  }),
  success: Schema.Struct({ id: Schema.String }),
  failure: IssueToolError,
  failureMode: "return",
})
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

const LabelIssue = Tool.make("label_issue", {
  description: `Label a triage issue worth fixing or noise, like its page's buttons. Labels are what decision models are compared against.`,
  parameters: Schema.Struct({
    issue: IssueParameter,
    label: Api.Label.annotate({ description: "worth or noise" }),
  }),
  success: Schema.Struct({ id: Schema.String, label: Api.Label }),
  failure: IssueToolError,
  failureMode: "return",
})
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const MergeIssues = Tool.make("merge_issues", {
  description: `Merge triage issues that are the same problem into one, such as the same crash with different frames, or a unit failure and the crash behind it. Only after asking the user: show them the issues and why you think they're the same, since a wrong merge mixes their events and statuses. The issue seen first is kept, and the others' IDs and links lead to it. It's muted if any of them was, open if any was and resolved otherwise. Split a fingerprint back out with triage unmerge or the issue's page.`,
  parameters: Schema.Struct({
    issues: Schema.Array(IssueParameter).annotate({
      description: "At least two issues to merge",
    }),
  }),
  success: Api.Merged,
  failure: IssueToolError,
  failureMode: "return",
})
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

/**
 * Tools for agents to find and read a server's issues and their events, to
 * resolve, mute, reopen, label and merge them, and to note why.
 */
export const IssueTools = Toolkit.make(
  ListIssues,
  GetIssue,
  GetIssueEvents,
  FindSimilarIssues,
  SetIssueStatus,
  AddIssueNote,
  LabelIssue,
  MergeIssues,
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
      set_issue_status: Effect.fn("IssueTools.set_issue_status")(function* ({
        issue,
        status,
        note,
      }) {
        const id = issueId(issue);

        yield* admin
          .setStatus(id, status, note)
          .pipe(Effect.mapError(toIssueToolError));

        return { id, status };
      }),
      add_issue_note: Effect.fn("IssueTools.add_issue_note")(function* ({
        issue,
        text,
      }) {
        const id = issueId(issue);

        yield* admin.addNote(id, text).pipe(Effect.mapError(toIssueToolError));

        return { id };
      }),
      label_issue: Effect.fn("IssueTools.label_issue")(function* ({
        issue,
        label,
      }) {
        const id = issueId(issue);

        yield* admin
          .setLabel(id, label)
          .pipe(Effect.mapError(toIssueToolError));

        return { id, label };
      }),
      merge_issues: Effect.fn("IssueTools.merge_issues")(function* ({
        issues,
      }) {
        return yield* admin
          .merge(issues.map(issueId))
          .pipe(Effect.mapError(toIssueToolError));
      }),
    });
  }),
);

/** How triage's MCP server introduces itself, over any transport. */
export const mcpOptions = {
  name: "triage",
  version: packageJson.version,
  instructions:
    "Read crashes and errors triage collected from your machines. Find issues with list_issues, or pass get_issue an issue ID or a link to the issue's page, then page through its events with get_issue_events. find_similar_issues shows how issues like it were fixed. An issue's notes say why it was resolved or muted before and which host it regressed on: when one comes back, check whether that fix reached the host or it's a different case. Once you've fixed an issue, don't wait to be asked to close it. get_issue lists every host it happened on, and each one needs the fix: check it's in place on the hosts you can reach, and ask the user about the others. Then ask the user before resolving it with set_issue_status, with a note on what fixed it, the commit, package or version, and the hosts it's in place on. Keep findings along the way with add_issue_note. Mute an issue that's noise and can't be fixed, rather than resolving it, with a note on why, and label issues worth fixing or noise with label_issue. When issues are the same problem, ask the user before merging them with merge_issues.",
  protocols: [
    McpProtocol.v2026_07_28,
    McpProtocol.v2025_11_25,
    McpProtocol.v2025_06_18,
    McpProtocol.v2025_03_26,
    McpProtocol.v2024_11_05,
  ],
} as const;
