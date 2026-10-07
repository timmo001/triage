import { Config, Effect, Layer, Option, Ref, Schedule, Schema } from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/http";

const SelfInfo = Schema.Struct({
  data: Schema.Struct({ ip_address: Schema.String }),
});

const Discovery = Schema.Struct({
  data: Schema.Struct({ uuid: Schema.String }),
});

/**
 * Announces the MCP server on the ingress port to Home Assistant through the
 * Supervisor, which asks the user to add it, and withdraws it when the server
 * stops. Does nothing outside a Home Assistant app, where there's no
 * `$SUPERVISOR_TOKEN`.
 */
export const layerDiscovery = (options: {
  readonly port: number;
  readonly path: string;
}) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const token = yield* Config.option(Config.Redacted("SUPERVISOR_TOKEN"));

      if (Option.isNone(token)) {
        return;
      }

      const client = (yield* HttpClient.HttpClient).pipe(
        HttpClient.mapRequest(HttpClientRequest.bearerToken(token.value)),
        HttpClient.filterStatusOk,
      );

      const announced = yield* Ref.make(Option.none<string>());

      yield* Effect.addFinalizer(() =>
        Ref.get(announced).pipe(
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.void,
              onSome: (uuid) =>
                client
                  .execute(
                    HttpClientRequest.delete(
                      `http://supervisor/discovery/${uuid}`,
                    ),
                  )
                  .pipe(
                    Effect.andThen(
                      Effect.logInfo(
                        "Withdrew the MCP server from Home Assistant",
                      ),
                    ),
                    Effect.timeout("5 seconds"),
                    Effect.catch((error) =>
                      Effect.logWarning(
                        `Couldn't withdraw the MCP server from Home Assistant: ${error.message}`,
                      ),
                    ),
                  ),
            }),
          ),
        ),
      );

      yield* Effect.gen(function* () {
        // Home Assistant Core runs on the host network, where the app's
        // hostname may not resolve, so announce its address instead.
        const self = yield* client
          .get("http://supervisor/addons/self/info")
          .pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(SelfInfo)));

        const discovery = yield* client
          .execute(
            HttpClientRequest.post("http://supervisor/discovery").pipe(
              HttpClientRequest.bodyJsonUnsafe({
                service: "mcp",
                config: {
                  url: `http://${self.data.ip_address}:${options.port}${options.path}`,
                },
              }),
            ),
          )
          .pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(Discovery)));

        yield* Ref.set(announced, Option.some(discovery.data.uuid));

        yield* Effect.logInfo("Announced the MCP server to Home Assistant");
      }).pipe(
        Effect.retry({ times: 3, schedule: Schedule.exponential("1 second") }),
        Effect.catch((error) =>
          Effect.logWarning(
            `Couldn't announce the MCP server to Home Assistant: ${error.message}`,
          ),
        ),
        Effect.forkScoped,
      );
    }),
  ).pipe(Layer.provide(FetchHttpClient.layer));
