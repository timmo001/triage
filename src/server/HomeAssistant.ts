import { Config, Effect, Layer, Option, Schedule, Schema } from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/http";

const SelfInfo = Schema.Struct({
  data: Schema.Struct({ ip_address: Schema.String }),
});

/**
 * Announces the MCP server on the ingress port to Home Assistant through the
 * Supervisor, which asks the user to add it. Does nothing outside a Home
 * Assistant app, where there's no `$SUPERVISOR_TOKEN`. The Supervisor ignores
 * a repeated announcement, so it's sent on every start.
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

      yield* Effect.gen(function* () {
        // Home Assistant Core runs on the host network, where the app's
        // hostname may not resolve, so announce its address instead.
        const self = yield* client
          .get("http://supervisor/addons/self/info")
          .pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(SelfInfo)));

        yield* client.execute(
          HttpClientRequest.post("http://supervisor/discovery").pipe(
            HttpClientRequest.bodyJsonUnsafe({
              service: "mcp",
              config: {
                url: `http://${self.data.ip_address}:${options.port}${options.path}`,
              },
            }),
          ),
        );

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
