/**
 * The web UI's PWA config: what `@timmo001/groundwork-pwa` gives it. The build
 * writes the manifest from it, and the page and service worker read it.
 */
import { definePwaConfig } from "@timmo001/groundwork-pwa";

export default definePwaConfig({
  name: "Triage",
  shortName: "Triage",
  description: "Crashes and errors from your machines, grouped into issues",
  // Triage's own theme, which the base theme the manifest takes its colours
  // from by default isn't
  backgroundColor: "#111113",
  themeColor: "#111113",
  // The page sets its own colour-scheme tag
  colorScheme: false,
  // Triage has nothing to do with a share, so it stays out of the share sheet
  shareTarget: false,
  manifest: {
    categories: ["developer tools", "utilities"],
  },
});
