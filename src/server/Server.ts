import { BunHttpServer } from "@effect/platform-bun";
import { Api } from "@timmo001/effect-triage";
import { Effect, Layer, Option } from "effect";
import { HttpMiddleware, HttpRouter } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import { Store } from "../store/Store.js";
import { Hosts } from "./Hosts.js";

const defaultIssues = 50;

const maxIssues = 500;

const issueEvents = 20;

const AuthorizationLayer = Layer.effect(
  Api.Authorization,
  Effect.gen(function* () {
    const hosts = yield* Hosts;

    return Api.Authorization.of({
      bearer: Effect.fn(function* (httpEffect, { credential }) {
        const host = yield* hosts
          .authenticate(credential)
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

/** The triage API's routes, needing a `Store` and `Hosts`. */
export const routes = HttpApiBuilder.layer(Api.Api, {
  openapiPath: "/api/openapi.json",
}).pipe(
  Layer.provide([IngestHandlers, IssuesHandlers, SystemHandlers]),
  Layer.provide(AuthorizationLayer),
);

/** Serve the triage API on a port. */
export const layer = (options: {
  readonly hostname: string;
  readonly port: number;
}) =>
  HttpRouter.serve(routes).pipe(Layer.provide(BunHttpServer.layer(options)));
