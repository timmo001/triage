import { BunHttpServer } from "@effect/platform-bun";
import { Api } from "@timmo001/effect-triage";
import { Effect, Layer, Option, Redacted } from "effect";
import {
  HttpMiddleware,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import { Store } from "../store/Store.js";
import { agreement } from "../triage/Triager.js";
import { Work } from "../triage/Work.js";
import { Tokens } from "./Tokens.js";
import { bundleWeb } from "./webBundle.js" with { type: "macro" };

const defaultIssues = 50;

const maxIssues = 500;

const issueEvents = 20;

const HostAuthorizationLayer = Layer.effect(
  Api.HostAuthorization,
  Effect.gen(function* () {
    const tokens = yield* Tokens;

    return Api.HostAuthorization.of({
      bearer: Effect.fn(function* (httpEffect, { credential }) {
        const host = yield* tokens
          .authenticate("host", credential)
          .pipe(Effect.orDie, Effect.map(Option.getOrUndefined));

        if (host === undefined) {
          return yield* new Api.Unauthorized({
            message: "Missing or unknown host token",
          });
        }

        return yield* Effect.provideService(httpEffect, Api.CurrentHost, {
          name: host,
        });
      }),
    });
  }),
);

const AdminAuthorizationLayer = Layer.effect(
  Api.AdminAuthorization,
  Effect.gen(function* () {
    const tokens = yield* Tokens;

    return Api.AdminAuthorization.of({
      bearer: Effect.fn(function* (httpEffect, { credential }) {
        const admin = yield* tokens
          .authenticate("admin", credential)
          .pipe(Effect.orDie, Effect.map(Option.getOrUndefined));

        if (admin === undefined) {
          return yield* new Api.Unauthorized({
            message: "Missing or unknown admin token",
          });
        }

        return yield* Effect.provideService(httpEffect, Api.CurrentAdmin, {
          name: admin,
        });
      }),
    });
  }),
);

const WorkerAuthorizationLayer = Layer.effect(
  Api.WorkerAuthorization,
  Effect.gen(function* () {
    const tokens = yield* Tokens;

    return Api.WorkerAuthorization.of({
      bearer: Effect.fn(function* (httpEffect, { credential }) {
        const worker = yield* tokens
          .authenticate("worker", credential)
          .pipe(Effect.orDie, Effect.map(Option.getOrUndefined));

        if (worker === undefined) {
          return yield* new Api.Unauthorized({
            message: "Missing or unknown worker token",
          });
        }

        return yield* Effect.provideService(httpEffect, Api.CurrentWorker, {
          name: worker,
        });
      }),
    });
  }),
);

/** A requested number of issues, between 1 and `max`. */
const bounded = (limit: number | undefined, fallback: number, max: number) =>
  Math.min(Math.max(limit ?? fallback, 1), max);

const IngestHandlers = HttpApiBuilder.group(
  Api.Api,
  "ingest",
  Effect.fn(function* (handlers) {
    const store = yield* Store;

    return handlers.handle(
      "events",
      Effect.fn(function* ({ payload }) {
        const host = yield* Api.CurrentHost;

        const added = yield* store
          .add(payload.events.map((event) => ({ ...event, host: host.name })))
          .pipe(Effect.orDie);

        return { added };
      }),
    );
  }),
);

const IssuesHandlers = HttpApiBuilder.group(
  Api.Api,
  "issues",
  Effect.fn(function* (handlers) {
    const store = yield* Store;

    return handlers.handleAll({
      list: ({ query }) =>
        store
          .issues({
            ...query,
            limit: bounded(query.limit, defaultIssues, maxIssues),
            offset: Math.max(query.offset ?? 0, 0),
          })
          .pipe(Effect.orDie),
      counts: ({ query }) => store.issueCounts(query).pipe(Effect.orDie),
      get: Effect.fn(function* ({ params }) {
        const review = yield* store
          .review(params.id, issueEvents)
          .pipe(Effect.orDie);

        if (Option.isNone(review)) {
          return yield* new Api.IssueNotFound({ id: params.id });
        }

        return review.value;
      }),
      setStatus: ({ params, payload }) =>
        store.setStatus(params.id, payload.status).pipe(
          Effect.catchTags({
            IssueNotFound: () =>
              Effect.fail(new Api.IssueNotFound({ id: params.id })),
            StoreError: Effect.die,
          }),
        ),
      setLabel: ({ params, payload }) =>
        store.label(params.id, payload.label === "worth").pipe(
          Effect.catchTags({
            IssueNotFound: () =>
              Effect.fail(new Api.IssueNotFound({ id: params.id })),
            StoreError: Effect.die,
          }),
        ),
    });
  }),
);

const WorkHandlers = HttpApiBuilder.group(
  Api.Api,
  "work",
  Effect.fn(function* (handlers) {
    const work = yield* Work;
    const store = yield* Store;

    return handlers.handleAll({
      toDecide: ({ query }) =>
        work
          .toDecide(query.model, bounded(query.limit, Api.maxWork, Api.maxWork))
          .pipe(Effect.orDie),
      saveDecision: Effect.fn(function* ({ payload }) {
        const worker = yield* Api.CurrentWorker;

        yield* store.saveDecision(payload, worker.name).pipe(Effect.orDie);
      }),
      toSuggest: ({ query }) =>
        work
          .toSuggest({
            model: query.model,
            decisionModel: query.decisionModel,
            worth: query.worth,
            limit: bounded(query.limit, Api.maxWork, Api.maxWork),
          })
          .pipe(Effect.orDie),
      issue: Effect.fn(function* ({ params }) {
        const detail = yield* work.issue(params.id).pipe(Effect.orDie);

        if (Option.isNone(detail)) {
          return yield* new Api.IssueNotFound({ id: params.id });
        }

        return detail.value;
      }),
      saveSuggestion: Effect.fn(function* ({ payload }) {
        const worker = yield* Api.CurrentWorker;

        yield* store.saveSuggestion(payload, worker.name).pipe(Effect.orDie);
      }),
    });
  }),
);

const DecisionsHandlers = HttpApiBuilder.group(
  Api.Api,
  "decisions",
  Effect.fn(function* (handlers) {
    const store = yield* Store;

    return handlers.handle("agreement", () =>
      store.labelledDecisions.pipe(Effect.map(agreement), Effect.orDie),
    );
  }),
);

const HostsHandlers = HttpApiBuilder.group(
  Api.Api,
  "hosts",
  Effect.fn(function* (handlers) {
    const store = yield* Store;

    return handlers.handle("list", () => store.hosts.pipe(Effect.orDie));
  }),
);

const TokensHandlers = HttpApiBuilder.group(
  Api.Api,
  "tokens",
  Effect.fn(function* (handlers) {
    const tokens = yield* Tokens;

    return handlers.handleAll({
      list: ({ params }) => tokens.list(params.scope).pipe(Effect.orDie),
      add: ({ params, payload }) =>
        tokens.issue(params.scope, payload.name).pipe(
          Effect.map((token) => ({ token: Redacted.value(token) })),
          Effect.catchTag("StoreError", Effect.die),
        ),
      remove: ({ params }) =>
        tokens
          .revoke(params.scope, params.name)
          .pipe(Effect.catchTag("StoreError", Effect.die)),
    });
  }),
);

const SystemHandlers = HttpApiBuilder.group(Api.Api, "system", (handlers) =>
  Effect.succeed(
    handlers.handleAll({
      health: () => HttpMiddleware.withLoggerDisabled(Effect.void),
    }),
  ),
);

const apiRoutes = (
  adminAuthorization: Layer.Layer<Api.AdminAuthorization, never, Tokens>,
) =>
  HttpApiBuilder.layer(Api.Api, {
    openapiPath: "/api/openapi.json",
  }).pipe(
    Layer.provide([
      IngestHandlers,
      IssuesHandlers,
      HostsHandlers,
      WorkHandlers,
      DecisionsHandlers,
      TokensHandlers,
      SystemHandlers,
    ]),
    Layer.provide([
      HostAuthorizationLayer,
      adminAuthorization,
      WorkerAuthorizationLayer,
    ]),
  );

/** The triage API's routes, needing a `Store`, `Tokens` and the local `Work`. */
export const routes = apiRoutes(AdminAuthorizationLayer);

/**
 * Admin access for Home Assistant ingress, where Home Assistant has already
 * signed the user in. Only safe behind `onlyFrom`.
 */
const IngressAdminAuthorizationLayer = Layer.succeed(
  Api.AdminAuthorization,
  Api.AdminAuthorization.of({
    bearer: (httpEffect) =>
      Effect.provideService(httpEffect, Api.CurrentAdmin, {
        name: "home-assistant",
      }),
  }),
);

/** Refuses every request that doesn't come from `address`. */
const onlyFrom =
  (address: string) =>
  <E, R>(
    httpEffect: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
  ) =>
    Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) =>
      Option.exists(
        request.remoteAddress,
        (remote) => remote === address || remote === `::ffff:${address}`,
      )
        ? httpEffect
        : Effect.succeed(HttpServerResponse.empty({ status: 403 })),
    );

const contentTypes = new Map([
  ["html", "text/html; charset=utf-8"],
  ["js", "text/javascript; charset=utf-8"],
  ["css", "text/css; charset=utf-8"],
  ["svg", "image/svg+xml"],
]);

const { "index.html": indexHtml = "", ...assets } = bundleWeb();

/**
 * The web UI's assets, built into the binary. Their names carry a content
 * hash, so they never change.
 */
const webFiles = new Map(
  Object.entries(assets).map(([name, body]) => [
    name,
    HttpServerResponse.text(body, {
      contentType: contentTypes.get(name.split(".").pop() ?? ""),
      headers: { "cache-control": "public, max-age=31536000, immutable" },
    }),
  ]),
);

const notFound = HttpServerResponse.empty({ status: 404 });

/** The page, with its base set to `base` so links and assets resolve under it. */
const page = (base: string) =>
  HttpServerResponse.text(
    indexHtml.replace('<base href="/"', `<base href="${base}"`),
    {
      contentType: contentTypes.get("html"),
      headers: { "cache-control": "no-cache" },
    },
  );

const rootPage = page("/");

/** Home Assistant's ingress prefix, such as `/api/hassio_ingress/<token>`. */
const ingressPath = /^\/api\/hassio_ingress\/[\w-]+$/;

/**
 * The web UI. Asset files are served as they are, and every other path outside
 * the API gets the page, which routes in the browser. Under ingress the page's
 * base is the path Home Assistant serves it from.
 */
const web = (options: { readonly ingress: boolean }) =>
  HttpRouter.add("GET", "/*", (request) => {
    const path = new URL(request.url, "http://triage").pathname.slice(1);
    const file = webFiles.get(path);

    if (file !== undefined) {
      return Effect.succeed(file);
    }

    if (
      path === "api" ||
      path.startsWith("api/") ||
      (path.includes(".") && path !== "index.html")
    ) {
      return Effect.succeed(notFound);
    }

    const prefix = request.headers["x-ingress-path"];

    return Effect.succeed(
      options.ingress && prefix !== undefined && ingressPath.test(prefix)
        ? page(`${prefix}/`)
        : rootPage,
    );
  });

export interface ServeOptions {
  readonly hostname: string;
  readonly port: number;
  /**
   * Trust `X-Forwarded-Host` and `X-Forwarded-For` from a reverse proxy in
   * front of the server. Only set this when the proxy is the sole way in, as
   * clients can otherwise send these headers themselves.
   */
  readonly trustProxy: boolean;
  /**
   * A second port for Home Assistant ingress, which only answers `ingressFrom`
   * and treats every request as an admin's, since Home Assistant has already
   * signed the user in.
   */
  readonly ingressPort: Option.Option<number>;
  /** The address ingress requests come from: the Supervisor's. */
  readonly ingressFrom: string;
}

/**
 * Serve the triage API over plain HTTP. For HTTPS, put it behind a reverse
 * proxy or Cloudflare, which handle TLS.
 */
export const layer = (options: ServeOptions) =>
  Layer.mergeAll(
    HttpRouter.serve(
      Layer.merge(routes, web({ ingress: false })),
      options.trustProxy
        ? { middleware: HttpMiddleware.xForwardedHeaders }
        : {},
    ).pipe(
      Layer.provide(
        BunHttpServer.layer({ hostname: options.hostname, port: options.port }),
      ),
    ),
    Option.match(options.ingressPort, {
      onNone: () => Layer.empty,
      onSome: (port) =>
        HttpRouter.serve(
          Layer.merge(
            apiRoutes(IngressAdminAuthorizationLayer),
            web({ ingress: true }),
          ),
          { middleware: onlyFrom(options.ingressFrom) },
        ).pipe(
          Layer.provide(
            BunHttpServer.layer({ hostname: options.hostname, port }),
          ),
        ),
    }),
  );
