// The issue states' colours, as the hex each starts from. The theme build
// solves them against every built-in theme's surfaces, and an imported theme
// solves them in the browser, so each state reads in every theme and mode.
export const stateTones = {
  new: "#2663eb",
  regressed: "#dc2627",
  ongoing: "#d9770a",
  quiet: "#81728b",
  resolved: "#18a349",
  muted: "#71717a",
} as const;
