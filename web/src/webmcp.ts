/**
 * The web UI's WebMCP tools: `filter-issues` and `open-issue`, which change
 * what the user is looking at. Resolving, muting and merging stay in the MCP
 * server, which asks the user first. The theme tools come from `pageTheme`.
 * Nothing registers in a browser without `document.modelContext`.
 */
import type {
  ModelContextTool,
  ToolArguments,
  ToolResult,
} from "@timmo001/groundwork-tokens/webmcp";
import { Api, Issue } from "@timmo001/effect-triage";
import { Result, Schema } from "effect";
import { registry } from "./AtomController.js";
import { issueHref, ListSettings, listSettings } from "./triage.js";

const text = (message: string): ToolResult => ({
  content: [{ type: "text", text: message }],
});

const list = (values: ReadonlyArray<string>, description: string) => ({
  type: "array",
  items: { type: "string", enum: values },
  description,
});

/** What `filter-issues` takes: any of the list's settings, changed together. */
const FilterInput = Schema.Struct({
  state: Schema.optionalKey(Schema.Array(Issue.State)),
  host: Schema.optionalKey(Schema.Array(Schema.String)),
  kind: Schema.optionalKey(Schema.Array(Issue.Kind)),
  label: Schema.optionalKey(Schema.Array(Api.LabelFilter)),
  search: Schema.optionalKey(Schema.String),
  sort: Schema.optionalKey(Api.IssueSort),
  order: Schema.optionalKey(Api.SortOrder),
  // An empty string stops grouping, as the list's own "Nothing" choice does
  group: Schema.optionalKey(
    Schema.Union([Api.IssueGrouping, Schema.Literal("")]),
  ),
});

const OpenInput = Schema.Struct({ id: Schema.NonEmptyString });

/** Shows a page of the UI, as following one of its links would. */
const go = (href: string) => {
  const url = new URL(href, document.baseURI);

  if (url.href !== location.href) {
    history.pushState(null, "", url.href);
    window.scrollTo(0, 0);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }
};

const filterIssues: ModelContextTool = {
  name: "filter-issues",
  description:
    "Filter, sort or group the issue list the user is looking at, and show it. Only the settings given change; an empty list or search clears that filter, and an empty group stops grouping.",
  inputSchema: {
    type: "object",
    properties: {
      state: list(Issue.State.literals, "The states to show"),
      host: {
        type: "array",
        items: { type: "string" },
        description: "The host names to show",
      },
      kind: list(Issue.Kind.literals, "The kinds to show"),
      label: list(Api.LabelFilter.literals, "The labels to show"),
      search: { type: "string", description: "Words in the issue's title" },
      sort: { type: "string", enum: Api.IssueSort.literals },
      order: { type: "string", enum: Api.SortOrder.literals },
      group: { type: "string", enum: [...Api.IssueGrouping.literals, ""] },
    },
  },
  execute: async (input: ToolArguments) => {
    const change = Schema.decodeUnknownResult(FilterInput)(input);

    if (Result.isFailure(change)) {
      return text(`Those settings aren't valid: ${String(change.failure)}`);
    }

    // Empty values clear a setting, so the list falls back to its default
    const merged = Object.fromEntries(
      Object.entries({
        ...registry.get(listSettings),
        ...change.success,
      }).filter(([, value]) => value !== undefined && value.length > 0),
    );

    const next = Schema.decodeUnknownResult(ListSettings)(merged);

    if (Result.isFailure(next)) {
      return text(`Those settings aren't valid: ${String(next.failure)}`);
    }

    registry.set(listSettings, next.success);
    go("./");

    return text(`Showing the issue list with ${JSON.stringify(next.success)}`);
  },
};

const openIssue: ModelContextTool = {
  name: "open-issue",
  description:
    "Open an issue's page for the user, by its id, such as one from the triage MCP server's list_issues.",
  inputSchema: {
    type: "object",
    properties: { id: { type: "string", description: "The issue's id" } },
    required: ["id"],
  },
  execute: async (input: ToolArguments) => {
    const decoded = Schema.decodeUnknownResult(OpenInput)(input);

    if (Result.isFailure(decoded)) {
      return text("Give the issue's id.");
    }

    go(issueHref(decoded.success.id));

    return text(`Opened issue ${decoded.success.id}`);
  },
};

/** Registers the tools. Returns whether the browser offered WebMCP. */
export const registerIssueTools = (signal?: AbortSignal): boolean => {
  const context = document.modelContext;

  if (context === undefined) {
    return false;
  }

  for (const tool of [filterIssues, openIssue]) {
    void context.registerTool(tool, signal === undefined ? {} : { signal });
  }

  return true;
};
