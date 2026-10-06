// The web UI, rebuilt on each page load, sending everything but the page to a triage
// server: the background dev server unless TRIAGE_DEV_API says otherwise.
import index from "../web/index.html";

const api = process.env["TRIAGE_DEV_API"] ?? "http://127.0.0.1:7172";

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env["PORT"] ?? 7180),
  // Bun's hot reloading breaks Lit's standard decorators
  // ("__decoratorStart is not a function"), so reload the page instead.
  development: { hmr: false, console: true },
  routes: { "/": index },
  fetch: (request) => {
    const url = new URL(request.url);

    return fetch(new Request(new URL(url.pathname + url.search, api), request));
  },
});

console.log(`Web UI at ${server.url.href}, using the API at ${api}`);
