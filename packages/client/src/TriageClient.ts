import { Api } from "@timmo001/effect-triage";
import { Context, Layer, Redacted, Schedule } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import { HttpApiClient, HttpApiMiddleware } from "effect/http-api";

export interface TriageClientOptions {
  /** The triage server's base URL, such as `https://triage.example.com`. */
  readonly url: string;
  /**
   * A host token to upload events, or an admin token to read issues. Each is
   * refused by the other's endpoints.
   */
  readonly token: Redacted.Redacted;
}

/** A typed client for a triage server's HTTP API. */
export class TriageClient extends Context.Service<
  TriageClient,
  HttpApiClient.ForApi<typeof Api.Api>
>()("@timmo001/effect-triage-client/TriageClient") {
  /** A client for the given server, authenticating with a token. */
  static readonly layer = (options: TriageClientOptions) => {
    const bearer: HttpApiMiddleware.HttpApiMiddlewareClient<
      never,
      never,
      never
    > = ({ next, request }) =>
      next(HttpClientRequest.bearerToken(request, options.token));

    return Layer.effect(
      TriageClient,
      HttpApiClient.make(Api.Api, {
        transformClient: (client) =>
          client.pipe(
            HttpClient.mapRequest(
              HttpClientRequest.prependUrl(options.url.replace(/\/+$/, "")),
            ),
            HttpClient.retryTransient({
              schedule: Schedule.exponential("200 millis"),
              times: 3,
            }),
          ),
      }),
    ).pipe(
      Layer.provide([
        HttpApiMiddleware.layerClient(Api.HostAuthorization, bearer),
        HttpApiMiddleware.layerClient(Api.AdminAuthorization, bearer),
      ]),
    );
  };
}
