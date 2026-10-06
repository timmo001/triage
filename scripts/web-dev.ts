// The web UI with hot reloading, sending everything but the page to a triage
// server: the background dev server unless TRIAGE_DEV_API says otherwise.
import index from "../web/index.html";

const api = process.env["TRIAGE_DEV_API"] ?? "http://127.0.0.1:7172";

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env["PORT"] ?? 7180),
  development: { hmr: true, console: true },
  routes: { "/": index },
  fetch: (request) => {
    const url = new URL(request.url);

    return fetch(new Request(new URL(url.pathname + url.search, api), request));
  },
});

console.log(`Web UI at ${server.url.href}, using the API at ${api}`);
