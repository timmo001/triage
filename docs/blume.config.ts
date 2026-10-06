import { defineConfig } from "blume";
import { cloudflare } from "blume/deploy";
import commandPages from "./commands-sidebar.json" with { type: "json" };

export default defineConfig({
  title: "Triage",
  description:
    "Capture crashes and errors from your machines, decide which are worth fixing, and suggest fixes.",
  logo: {
    image: {
      alt: "Triage",
      dark: "/logo-dark.svg",
      light: "/logo-light.svg",
    },
    text: "Triage",
  },
  content: {
    root: "src/content/docs",
  },
  markdown: {
    externalLinks: true,
  },
  github: {
    owner: "timmo001",
    repo: "triage",
    branch: "main",
    dir: "docs",
  },
  navigation: {
    repo: true,
    sidebar: [
      "/",
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
      light: "#b45309",
      dark: "#f59e0b",
    },
  },
  ai: {
    assistant: {
      enabled: false,
    },
  },
  agents: {
    agentReadability: true,
    contentSignals: {
      aiInput: true,
      aiTrain: false,
      search: true,
    },
    llmsTxt: true,
    mcp: {
      enabled: true,
      route: "/mcp",
    },
    webmcp: true,
  },
  deployment: cloudflare({
    site: "https://triage.timmo.dev",
  }),
  feedback: false,
  lastModified: "git",
  seo: {
    og: {
      enabled: true,
      logo: "src/assets/logo.svg",
      site: "triage.timmo.dev",
    },
  },
});
