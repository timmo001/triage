/**
 * The service worker, bundled to `sw.js`: keeps the app shell so the page
 * starts offline. The build sets `TRIAGE_VERSION` and `TRIAGE_SHELL`, so each
 * release's worker differs from the last, replaces it and its cache, and takes
 * over open pages by itself.
 */
import {
  serveShell,
  type ShellWorkerScope,
} from "@timmo001/groundwork-pwa/worker";
import config from "../pwa.config.ts";

declare const self: ShellWorkerScope;

/** Set by the build, which replaces each use below with its value. */
declare const process: {
  readonly env: {
    readonly TRIAGE_VERSION?: string;
    readonly TRIAGE_SHELL?: string;
  };
};

const resolve = (path: string) => new URL(path, self.location.href).href;

// The server's own routes are live, so they always go to the network rather
// than being answered from the cache
const live = ["api/", "mcp"].map(resolve);

// The page's own files too, so the app starts offline after its first visit,
// before the worker has seen them fetched. The build adds the hashed script
// and styles
const shell: ReadonlyArray<string> = JSON.parse(
  process.env.TRIAGE_SHELL ?? "[]",
);

serveShell(
  self,
  {
    ...config,
    offline: {
      worker: "sw.js",
      shell: ["./", "manifest.webmanifest", "icons/icon-192.png", ...shell],
    },
  },
  {
    version: process.env.TRIAGE_VERSION ?? "dev",
    routes: [
      ({ request }) =>
        live.some((prefix) => request.url.startsWith(prefix))
          ? fetch(request)
          : undefined,
    ],
  },
);
