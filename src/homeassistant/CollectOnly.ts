/**
 * The Home Assistant app without a server of its own: it collects Home
 * Assistant's errors into a local store, as the server would, and sends them
 * to a triage server elsewhere with a host token, the way the agent does on a
 * Linux host. The store keeps them while the server can't be reached.
 *
 * It still answers the Supervisor's watchdog on the main port, and its
 * ingress page says where the errors go instead of showing the web UI. There's
 * no MCP server to announce.
 */
import { BunHttpServer } from "@effect/platform-bun";
import { Effect, Layer, Option, Predicate, Ref, Schedule } from "effect";
import {
  HttpMiddleware,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http";
import { Translations } from "../server/Translations.js";
import { Uploader } from "../upload/Uploader.js";
import { CollectionStatus } from "./Status.js";

/** How often new events go to the server. */
const uploadEvery = "30 seconds";

export interface CollectOnlyOptions {
  readonly hostname: string;
  readonly port: number;
  /** Home Assistant's ingress port, which shows where the errors go. */
  readonly ingressPort: Option.Option<number>;
  /** The address ingress requests come from: the Supervisor's. */
  readonly ingressFrom: string;
  /** The server the errors go to, for the ingress page's link. */
  readonly server: string;
}

/**
 * Sends new events to the server now and every 30 seconds after, saying when
 * it can't reach it and when it can again, rather than on every try.
 */
const uploading = Layer.effectDiscard(
  Effect.gen(function* () {
    const uploader = yield* Uploader;
    const reachable = yield* Ref.make(true);

    yield* uploader.upload.pipe(
      Effect.tap((result) =>
        Effect.gen(function* () {
          if (!(yield* Ref.getAndSet(reachable, true))) {
            yield* Effect.logInfo("Reached the server again");
          }

          if (result.sent > 0) {
            yield* Effect.logInfo(`Sent ${result.sent} events to the server`);
          }
        }),
      ),
      Effect.catch((error) =>
        Effect.gen(function* () {
          if (yield* Ref.getAndSet(reachable, false)) {
            yield* Effect.logWarning(
              `Couldn't send events to the server, keeping them to retry: ${error.message}`,
            );
          }
        }),
      ),
      Effect.repeat(Schedule.spaced(uploadEvery)),
      Effect.forkScoped,
    );
  }),
);

/** A message from the translations, in its plain or `other` plural form. */
const message = (
  messages: Translations["Service"]["messages"],
  key: string,
  params: Readonly<Record<string, string>> = {},
) => {
  const found = messages[key];

  const text =
    found === undefined ? key : Predicate.isString(found) ? found : found.other;

  return text.replace(
    /\{(\w+)\}/g,
    (placeholder, name: string) => params[name] ?? placeholder,
  );
};

/** The ingress page: where the errors go, and whether they're being read. */
const ingressPage = (server: string) =>
  HttpRouter.add(
    "GET",
    "/*",
    Effect.gen(function* () {
      const { language, messages } = yield* Translations;
      const status = yield* (yield* CollectionStatus).get;

      const link = `<a href="${Bun.escapeHTML(server)}" target="_blank" rel="noopener">${Bun.escapeHTML(server)}</a>`;

      const notice = Option.match(status, {
        onNone: () => "",
        onSome: (state) =>
          state === "noJournal"
            ? `<p class="warning">${Bun.escapeHTML(message(messages, "issues.homeAssistantNotCollected"))}</p>`
            : "",
      });

      return HttpServerResponse.text(
        `<!doctype html>
<html lang="${Bun.escapeHTML(language)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Triage</title>
<style>
:root { color-scheme: light dark; font-family: system-ui, sans-serif; }
body { max-width: 36rem; margin: 3rem auto; padding: 0 1.5rem; line-height: 1.5; }
.warning { color: #b45309; }
</style>
</head>
<body>
<h1>${Bun.escapeHTML(message(messages, "collectOnly.title"))}</h1>
<p>${Bun.escapeHTML(message(messages, "collectOnly.message")).replace("{server}", link)}</p>
${notice}
</body>
</html>
`,
        {
          contentType: "text/html; charset=utf-8",
          headers: { "cache-control": "no-cache" },
        },
      );
    }),
  );

/** Only answers the Supervisor, as the server's ingress port does. */
const supervisorOnly =
  (supervisor: string) =>
  <E, R>(
    httpEffect: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
  ) =>
    Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) =>
      Option.exists(
        request.remoteAddress,
        (remote) => remote === supervisor || remote === `::ffff:${supervisor}`,
      )
        ? httpEffect
        : Effect.succeed(HttpServerResponse.empty({ status: 403 })),
    );

/**
 * Collect-only mode's own parts: uploading, the health check the Supervisor's
 * watchdog asks for, and the ingress page. Needs an `Uploader`, the store it
 * reads, and the `Translations` and `CollectionStatus` for the page.
 */
export const layer = (options: CollectOnlyOptions) =>
  Layer.mergeAll(
    uploading,
    HttpRouter.serve(
      // The watchdog asks often, so its answers stay out of the log
      HttpRouter.add(
        "GET",
        "/api/health",
        HttpMiddleware.withLoggerDisabled(
          Effect.succeed(HttpServerResponse.empty()),
        ),
      ),
    ).pipe(
      Layer.provide(
        BunHttpServer.layer({
          hostname: options.hostname,
          port: options.port,
        }),
      ),
    ),
    Option.match(options.ingressPort, {
      onNone: () => Layer.empty,
      onSome: (port) =>
        HttpRouter.serve(ingressPage(options.server), {
          middleware: supervisorOnly(options.ingressFrom),
        }).pipe(
          Layer.provide(
            BunHttpServer.layer({ hostname: options.hostname, port }),
          ),
        ),
    }),
  );
