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
    baseUrl: new URL(".", document.baseURI).href.replace(/\/$/, ""),
  },
) {}

const issuesKey = ["issues"];

/** The most issues the list shows. */
export const issueLimit = 500;

export const issues = Atom.family((host: string) =>
  TriageApi.query("issues", "list", {
    query: host === "" ? { limit: issueLimit } : { limit: issueLimit, host },
    reactivityKeys: issuesKey,
  }),
);

export const hosts = TriageApi.query("hosts", "list", {
  reactivityKeys: issuesKey,
});

export const issue = Atom.family((id: string) =>
  TriageApi.query("issues", "get", {
    params: { id },
    reactivityKeys: issuesKey,
  }),
);

export const setStatus = TriageApi.mutation("issues", "setStatus");

export const setLabel = TriageApi.mutation("issues", "setLabel");

export type Route = Data.TaggedEnum<{
  Issues: {};
  Issue: { readonly id: string };
}>;

export const Route = Data.taggedEnum<Route>();

/**
 * Where the UI lives, from the page's `<base>`: `/`, or Home Assistant's
 * ingress path. Every route is relative to it.
 */
const basePath = new URL(document.baseURI).pathname;

const issuePattern = new URLPattern({ pathname: "/issues/:id" });

const parseRoute = (): Route => {
  const path = location.pathname.startsWith(basePath)
    ? `/${location.pathname.slice(basePath.length)}`
    : location.pathname;

  const id = issuePattern.exec({ pathname: path })?.pathname.groups["id"];

  return id === undefined
    ? Route.Issues()
    : Route.Issue({ id: decodeURIComponent(id) });
};

/** The link within the UI that a click lands on, if any. */
const appLink = (event: MouseEvent) => {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return undefined;
  }

  const link = event
    .composedPath()
    .find((target) => target instanceof HTMLAnchorElement);

  if (
    link === undefined ||
    link.target !== "" ||
    link.hasAttribute("download") ||
    link.origin !== location.origin ||
    !link.pathname.startsWith(basePath)
  ) {
    return undefined;
  }

  return link;
};

/**
 * The page to show, from the URL's path. Links within the UI change the path
 * without reloading, and the back and forward buttons follow it.
 */
export const route = Atom.readable((get) => {
  const update = () => get.setSelf(parseRoute());

  const onClick = (event: MouseEvent) => {
    const link = appLink(event);

    if (link === undefined) {
      return;
    }

    event.preventDefault();

    if (link.href !== location.href) {
      history.pushState(null, "", link.href);
      window.scrollTo(0, 0);
      update();
    }
  };

  window.addEventListener("popstate", update);
  document.addEventListener("click", onClick);
  get.addFinalizer(() => {
    window.removeEventListener("popstate", update);
    document.removeEventListener("click", onClick);
  });

  return parseRoute();
});

/** Links resolve against the page's base, so they work under any prefix. */
export const homeHref = "./";

export const issueHref = (id: string) => `issues/${encodeURIComponent(id)}`;
