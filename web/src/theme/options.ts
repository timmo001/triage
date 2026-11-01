// The web UI's theme choices: its own Triage theme, the default, and
// Groundwork's Snag. A visitor can also import their own.
export const themeOptions = {
  key: "triage:theme",
  defaultTheme: "triage",
} as const;

export const themeChoices = [
  { id: "triage", name: "Triage" },
  { id: "snag", name: "Snag" },
] as const;
