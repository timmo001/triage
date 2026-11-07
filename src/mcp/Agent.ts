/**
 * The Code Mode surface. `triage agent tools --json` describes each of the MCP
 * server's issue tools, and `triage agent call <tool>` runs one with its
 * input as JSON on stdin, so Code Mode and MCP share one implementation and
 * the OpenCode plugin in `opencode-plugin/` only needs the binary.
 */
import {
  Context,
  Duration,
  Effect,
  Option,
  Record,
  Schema,
  Stream,
} from "effect";
import { Tool } from "effect/ai";
import { IssueTools } from "./IssueTools.js";

/** Why a Code Mode call failed; its message is the tool's failure. */
export class AgentError extends Schema.TaggedError<AgentError>()("AgentError", {
  message: Schema.String,
}) {}

const timeout = Duration.minutes(2);

/** The tool names `agent call` takes. */
export const toolNames = Record.keys(IssueTools.tools);

export type ToolName = (typeof toolNames)[number];

// The input key whose value narrows a write's permission, so "always allow"
// covers one issue rather than every one.
const resources: Partial<Record<ToolName, string>> = {
  set_issue_status: "issue",
  label_issue: "issue",
  add_issue_note: "issue",
};

// Asked about on every call: a wrong one is hard to undo.
const alwaysAsk: ReadonlySet<ToolName> = new Set(["merge_issues"]);

const pinned: ReadonlySet<ToolName> = new Set(["list_issues", "get_issue"]);

/** One tool as the plugin registers it. */
export const ManifestTool = Schema.Struct({
  name: Schema.String,
  argv: Schema.Array(Schema.String),
  description: Schema.String,
  access: Schema.Literals(["read", "write"]),
  alwaysAsk: Schema.Boolean,
  pinned: Schema.Boolean,
  timeoutMillis: Schema.Int,
  json: Schema.Boolean,
  /** The whole input goes to the command as JSON on stdin. */
  stdin: Schema.Boolean,
  input: Schema.Unknown,
  resource: Schema.optionalKey(Schema.String),
});

/** Every tool, and whether this machine has a server to call them on. */
export const Manifest = Schema.Struct({
  available: Schema.Boolean,
  tools: Schema.Array(ManifestTool),
});

// Effect's AI transformer makes optional keys nullable for model providers;
// Code Mode shows the plain schema, rejecting keys a tool doesn't take.
const jsonSchema = (schema: Schema.Top) => {
  const document = Schema.toJsonSchemaDocument(schema, {
    onExcessProperty: "error",
  });

  return Object.keys(document.definitions).length === 0
    ? document.schema
    : { ...document.schema, $defs: document.definitions };
};

/** The Code Mode manifest; `available` says whether a server is set up. */
export const manifest = (available: boolean): typeof Manifest.Type => ({
  available,
  tools: toolNames.map((name) => {
    const tool = IssueTools.tools[name];
    const resource = resources[name];

    return {
      name,
      argv: ["agent", "call", name],
      description: Tool.getDescription(tool) ?? name,
      access: Context.get(tool.annotations, Tool.Readonly) ? "read" : "write",
      alwaysAsk: alwaysAsk.has(name),
      pinned: pinned.has(name),
      timeoutMillis: Duration.toMillis(timeout),
      json: true,
      stdin: true,
      input: jsonSchema(tool.parametersSchema),
      ...(resource !== undefined && { resource }),
    };
  }),
});

const readInput = (name: ToolName, text: string) =>
  Schema.decodeUnknownEffect(
    Schema.fromJsonString(
      Schema.toEncoded(IssueTools.tools[name].parametersSchema),
    ),
  )(text.trim() === "" ? "{}" : text, { onExcessProperty: "error" }).pipe(
    Effect.mapError(
      (error) => new AgentError({ message: `Invalid input: ${error.message}` }),
    ),
  );

/**
 * Run one tool with its JSON input and return its JSON result. Needs the
 * toolkit's handlers, which need an `IssueAdmin`.
 */
export const call = Effect.fn("agentCall")(
  function* (name: ToolName, text: string) {
    const toolkit = yield* IssueTools;
    const input = yield* readInput(name, text);

    const results = yield* toolkit.handle(name, input);
    const last = yield* Stream.runLast(results);

    if (Option.isNone(last)) {
      return yield* new AgentError({ message: `${name} returned nothing` });
    }

    if (last.value.isFailure) {
      const failure = last.value.encodedResult;

      return yield* new AgentError({
        message: Schema.is(Schema.Struct({ message: Schema.String }))(failure)
          ? failure.message
          : JSON.stringify(failure),
      });
    }

    return JSON.stringify(last.value.encodedResult, null, 2);
  },
  Effect.timeoutOrElse({
    duration: timeout,
    orElse: () => Effect.fail(new AgentError({ message: "timed out" })),
  }),
  Effect.mapError((error) =>
    error instanceof AgentError
      ? error
      : new AgentError({ message: error.message }),
  ),
);
