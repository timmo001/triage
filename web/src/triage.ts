import { BrowserKeyValueStore } from "@effect/platform-browser";
import { Api } from "@timmo001/effect-triage";
import { Data, Layer, Schema } from "effect";
import { FetchHttpClient, HttpClientRequest } from "effect/http";
import { HttpApiMiddleware } from "effect/http-api";
import { Atom, AtomHttpApi } from "effect/reactivity";

const storage = Atom.runtime(BrowserKeyValueStore.layerLocalStorage);

/** The admin token, kept in the browser. Empty until someone signs in. */
export const token = Atom.kvs({
  runtime: storage,
  key: "triage-admin-token",
  schema: Schema.String,
  defaultValue: () => "",
});

/**
 * The triage API, relative to the page so it works under a path prefix such
 * as Home Assistant's ingress.
 */
export class TriageApi extends AtomHttpApi.Service<TriageApi>()(
  "triage/web/TriageApi",
  {
    api: Api.Api,
    httpClient: (get) => {
      const bearer: HttpApiMiddleware.HttpApiMiddlewareClient<
        never,
        never,
        never
      > = ({ next, request }) =>
        next(HttpClientRequest.bearerToken(request, get(token)));

      return Layer.mergeAll(
        FetchHttpClient.layer,
        HttpApiMiddleware.layerClient(Api.HostAuthorization, bearer),
        HttpApiMiddleware.layerClient(Api.AdminAuthorization, bearer),
        HttpApiMiddleware.layerClient(Api.WorkerAuthorization, bearer),
      );
    },
    baseUrl: new URL(".", location.href).href.replace(/\/$/, ""),
  },
) {}

const issuesKey = ["issues"];

/** The most issues the list shows. */
export const issueLimit = 500;

export const issues = TriageApi.query("issues", "list", {
  query: { limit: issueLimit },
  reactivityKeys: issuesKey,
});

export const issue = Atom.family((id: string) =>
  TriageApi.query("issues", "get", {
    params: { id },
    reactivityKeys: issuesKey,
  }),
);

export const setStatus = TriageApi.mutation("issues", "setStatus");

export type Route = Data.TaggedEnum<{
  Issues: {};
  Issue: { readonly id: string };
}>;

export const Route = Data.taggedEnum<Route>();

const parseRoute = (hash: string): Route => {
  const match = /^#\/issues\/([^/]+)$/.exec(hash);

  return match?.[1] === undefined
    ? Route.Issues()
    : Route.Issue({ id: decodeURIComponent(match[1]) });
};

/** The page to show, from the URL's hash, so it works under any path prefix. */
export const route = Atom.readable((get) => {
  const update = () => get.setSelf(parseRoute(location.hash));

  window.addEventListener("hashchange", update);
  get.addFinalizer(() => window.removeEventListener("hashchange", update));

  return parseRoute(location.hash);
});

export const issueHref = (id: string) => `#/issues/${encodeURIComponent(id)}`;
