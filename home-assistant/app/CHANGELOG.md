## Agents

- **The `triage-resolve` skill.** After an agent fixes a failing unit, a crash, an out-of-memory kill or a logged error on a machine triage collects from, the skill has it find the issues the fix settles and close them, with a note on what fixed it and where. Add it with `npx skills add timmo001/triage` or the Claude Code marketplace (`/plugin install triage --marketplace timmo001/triage`). See [Agents](https://triage.timmo.dev/agents#skill).
- **Release archives carry the skill** in `skills/`, beside the binary, so a mise install keeps it matched to the version you run.
- **The MCP server's instructions** now ask agents to resolve issues raised while their fix was in progress, too.

## Home Assistant

- Releases also go to the [shared Home Assistant app repository](https://github.com/timmo001/home-assistant-apps), so you can add all my apps at once. Add one repository or the other, not both: Home Assistant treats them as different apps, so moving between them starts with empty settings and data.

## Dependencies

- Effect 4.0.5, Node.js 26.12.0 and other dependency updates.

