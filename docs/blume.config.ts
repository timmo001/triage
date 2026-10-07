import { docsConfig } from "@timmo001/docs-kit/blume";
import { defineConfig } from "blume";
import commandPages from "./commands-sidebar.json" with { type: "json" };

export default defineConfig(
  docsConfig({
    title: "Triage",
    description:
      "Capture crashes and errors from your machines, decide which are worth fixing, and suggest fixes.",
    site: "triage.timmo.dev",
    github: { owner: "timmo001", repo: "triage" },
    redirects: [{ from: "/setup/hardware", to: "/hardware" }],
    navigation: {
      sidebar: [
        "/",
        "/hardware",
        "/install",
        {
          label: "Setup",
          items: ["/setup/server", "/setup/hosts", "/setup/workers"],
        },
        "/configuration",
        "/issues",
        "/choices",
        "/privacy",
        "/libraries",
        {
          label: "Commands",
          root: "/commands",
          items: commandPages.filter((page) => page !== "/commands"),
          display: "group",
          collapsed: true,
        },
      ],
    },
    theme: {
      accent: {
        light: "#a0661c",
        dark: "#e6ad55",
      },
    },
  }),
);
