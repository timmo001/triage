import { BunHttpServer } from "@effect/platform-bun";
import { Api } from "@timmo001/effect-triage";
import { Effect, Layer, Option } from "effect";
import { HttpMiddleware, HttpRouter } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import { Store } from "../store/Store.js";
import { Tokens } from "./Tokens.js";

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
            limit: Math.min(
              Math.max(query.limit ?? defaultIssues, 1),
              maxIssues,
            ),
          })
          .pipe(Effect.orDie),
      get: Effect.fn(function* ({ params }) {
        const detail = yield* store
          .issue(params.id, issueEvents)
          .pipe(Effect.orDie);

        if (Option.isNone(detail)) {
          return yield* new Api.IssueNotFound({ id: params.id });
        }

        return detail.value;
      }),
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

/** The triage API's routes, needing a `Store` and `Tokens`. */
export const routes = HttpApiBuilder.layer(Api.Api, {
  openapiPath: "/api/openapi.json",
}).pipe(
  Layer.provide([IngestHandlers, IssuesHandlers, SystemHandlers]),
  Layer.provide([HostAuthorizationLayer, AdminAuthorizationLayer]),
);

export interface ServeOptions {
  readonly hostname: string;
  readonly port: number;
  /**
   * Trust `X-Forwarded-Host` and `X-Forwarded-For` from a reverse proxy in
   * front of the server. Only set this when the proxy is the sole way in, as
   * clients can otherwise send these headers themselves.
   */
  readonly trustProxy: boolean;
}

/**
 * Serve the triage API over plain HTTP. For HTTPS, put it behind a reverse
 * proxy or Cloudflare, which handle TLS.
 */
export const layer = (options: ServeOptions) =>
  HttpRouter.serve(
    routes,
    options.trustProxy ? { middleware: HttpMiddleware.xForwardedHeaders } : {},
  ).pipe(
    Layer.provide(
      BunHttpServer.layer({ hostname: options.hostname, port: options.port }),
    ),
  );
