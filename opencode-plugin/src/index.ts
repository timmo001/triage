/**
 * The triage OpenCode plugin: the issues on the server in $TRIAGE_SERVER as
 * the `triage` Code Mode namespace. It reads the tools from
 * `triage agent tools --json`, which lists the MCP server's issue tools, and
 * runs each with `triage agent call`, which redacts notes on this machine
 * before they're sent, so they always match the binary on the PATH. Copied
 * from System Bridge's plugin, itself modelled on upkeep's.
 */
import { Plugin } from "@opencode/plugin/effect";
import { Tool } from "@opencode/schema/tool";
import { Effect, Result, Schema } from "effect";
import { strictInput } from "./input";
import { loadManifest, type ManifestTool, runTriage } from "./triage";

const namespace = "triage";

const decodeJson = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Unknown),
);

/** Tool input as JSON; each tool's own schema has already checked it. */
const Input = Schema.Record(Schema.String, Schema.Json);

const decodeInput = Schema.decodeUnknownEffect(Input);

const isNonEmptyString = Schema.is(Schema.NonEmptyString);

/**
 * What the permission covers: the tool, narrowed by its resource input when
 * it names one, so "always allow" on set_issue_status covers one issue.
 */
const permissionTarget = (tool: ManifestTool, input: typeof Input.Type) => {
  const value = tool.resource === undefined ? undefined : input[tool.resource];

  return isNonEmptyString(value) ? `${tool.name} ${value}` : tool.name;
};

export default Plugin.define({
  id: "triage",
  effect: (context) =>
    Effect.gen(function* () {
      if (Bun.which("triage") === null) return;

      const manifest = yield* loadManifest.pipe(Effect.result);

      if (Result.isFailure(manifest)) {
        return yield* Effect.logWarning(
          `triage: no Code Mode tools: ${manifest.failure.message}`,
        );
      }

      // Without $TRIAGE_SERVER and $TRIAGE_ADMIN_TOKEN there's no server to
      // call, so leave the namespace out.
      if (!manifest.success.available) return;

      const sessionDirectory = (call: Tool.Context) =>
        context.session.get({ sessionID: call.sessionID }).pipe(
          Effect.map((session) => session.location.directory),
          Effect.mapError(
            (error) =>
              new Tool.Error({
                message: "Could not read the session's directory",
                error,
              }),
          ),
        );

      // OpenCode's prompt only shows the action for plugin permissions, so
      // the action names the tool and what it acts on; rules match it with
      // `triage.write *`.
      const assertWrite = (
        tool: ManifestTool,
        call: Tool.Context,
        input: typeof Input.Type,
        stdin: string,
      ) => {
        if (tool.access !== "write") return Effect.void;

        const target = permissionTarget(tool, input);
        const resource = `${namespace}_${target}`;

        return context.permission.assert({
          sessionID: call.sessionID,
          agent: call.agent,
          action: `${namespace}.write ${target}`,
          resources: [resource],
          // An empty save list keeps "always" from being stored, so the next call asks again.
          save: tool.alwaysAsk ? [] : [resource],
          metadata: {
            command: `triage ${tool.argv.join(" ")} ${stdin}`,
          },
          source: { type: "tool", messageID: call.messageID, id: call.id },
        });
      };

      const execute =
        (tool: ManifestTool) =>
        (input: typeof Input.Type, call: Tool.Context) =>
          Effect.gen(function* () {
            const stdin = JSON.stringify(input);

            yield* assertWrite(tool, call, input, stdin);

            const stdout = yield* runTriage(tool.argv, {
              cwd: yield* sessionDirectory(call),
              stdin: tool.stdin ? stdin : undefined,
              timeout: tool.timeoutMillis,
              env: { OPENCODE_SESSION_ID: call.sessionID },
            });

            if (!tool.json) return { output: stdout.trimEnd() };

            return {
              output: yield* decodeJson(stdout).pipe(
                Effect.mapError(
                  (error) =>
                    new Tool.Error({
                      message: `triage ${tool.name} did not print JSON: ${error.message}`,
                    }),
                ),
              ),
            };
          });

      yield* context.tool.transform((draft) => {
        draft.namespace({
          name: namespace,
          description:
            "Crashes and errors triage collected from your machines, on the server in $TRIAGE_SERVER. Find issues with list_issues, read one with get_issue (an ID or a link to its page), page through its events with get_issue_events, and see how issues like it were fixed with find_similar_issues. Notes say why an issue was resolved or muted before and which host it regressed on. Once you've fixed an issue, ask the user before resolving it with set_issue_status, with a note on what fixed it and the hosts it's in place on, and before merging with merge_issues. The triage-resolve skill has the full steps.",
        });

        for (const tool of manifest.success.tools) {
          const run = execute(tool);

          draft.add({
            name: tool.name,
            description: tool.description,
            input: strictInput(tool.input),
            output: tool.json ? Schema.Unknown : Schema.String,
            options:
              tool.access === "write"
                ? {
                    namespace,
                    codemode: true,
                    pinned: tool.pinned,
                    permission: `${namespace}.write`,
                  }
                : { namespace, codemode: true, pinned: tool.pinned },
            execute: (input, call) =>
              decodeInput(input).pipe(
                Effect.mapError(
                  (error) =>
                    new Tool.Error({
                      message: `Invalid input: ${error.message}`,
                    }),
                ),
                Effect.flatMap((decoded) => run(decoded, call)),
              ),
          });
        }
      });
    }),
});
