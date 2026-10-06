import { BrowserKeyValueStore } from "@effect/platform-browser";
import { Api, Issue } from "@timmo001/effect-triage";
import {
  Data,
  Effect,
  Equal,
  Layer,
  Option,
  Schedule,
  Schema,
  Stream,
} from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientError,
  HttpClientRequest,
} from "effect/http";
import { HttpApiMiddleware } from "effect/http-api";
import { Atom, AtomHttpApi, Reactivity } from "effect/reactivity";

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
    // Covers the server restarting, so a page doesn't fail mid-scroll.
    transformClient: HttpClient.retryTransient({
      schedule: Schedule.exponential("250 millis"),
      times: 5,
    }),
  },
) {}

const issuesKey = ["issues"];

/** How the issue list is filtered, sorted and grouped, kept between visits. */
export const ListSettings = Schema.Struct({
  state: Schema.optional(Issue.State),
  sort: Api.IssueSort,
  order: Api.SortOrder,
  group: Schema.optional(Api.IssueGrouping),
  host: Schema.optional(Schema.Array(Schema.String)),
  kind: Schema.optional(Schema.Array(Issue.Kind)),
  label: Schema.optional(Schema.Array(Api.LabelFilter)),
  search: Schema.optional(Schema.String),
});

export interface ListSettings extends Schema.Schema.Type<typeof ListSettings> {}

export const listSettings = Atom.kvs({
  runtime: storage,
  key: "triage-issue-list",
  schema: ListSettings,
  defaultValue: (): ListSettings => ({ sort: "lastSeen", order: "desc" }),
});

/** The groups someone has collapsed in the issue list, by group row ID. */
export const collapsedGroups = Atom.kvs({
  runtime: storage,
  key: "triage-collapsed-groups",
  schema: Schema.Array(Schema.String),
  defaultValue: (): ReadonlyArray<string> => [],
});

export const RowHeights = Schema.Struct({
  narrow: Schema.Finite,
  wide: Schema.Finite,
});

export interface RowHeights extends Schema.Schema.Type<typeof RowHeights> {}

/** The average issue row height last measured, so skeletons can match it. */
export const rowHeights = Atom.kvs({
  runtime: storage,
  key: "triage-row-heights",
  schema: RowHeights,
  defaultValue: (): RowHeights => ({ narrow: 52, wide: 46 }),
});

/** How many issues each page of the list fetches. */
const pageSize = 100;

/** Requests that couldn't be made or understood are defects, as in queries. */
const asDefects = <A, E, R>(
  effect: Effect.Effect<
    A,
    E | HttpClientError.HttpClientError | Schema.SchemaError,
    R
  >,
) =>
  Effect.catchIf(
    effect,
    (error) =>
      Schema.isSchemaError(error) || HttpClientError.isHttpClientError(error),
    (error) => Effect.die(error),
  );

/**
 * The issues matching the list settings, a page at a time. Writing to it
 * fetches the next page; changing the settings starts again from the first.
 */
export const issueList = TriageApi.runtime.factory.withReactivity(issuesKey)(
  TriageApi.runtime.pull((get) => {
    const settings = get(listSettings);

    return Stream.paginate(0, (offset) =>
      TriageApi.use((client) =>
        client.issues.list({
          query: { ...settings, limit: pageSize, offset },
        }),
      ).pipe(
        asDefects,
        Effect.map(
          (page) =>
            [
              page,
              page.length < pageSize
                ? Option.none()
                : Option.some(offset + pageSize),
            ] as const,
        ),
      ),
    );
  }),
);

/** The settings the counts depend on, so changing the state or sort keeps them. */
const countFilters = Atom.make((get): Api.IssueFilters => {
  const { host, kind, label, search } = get(listSettings);

  return { host, kind, label, search };
}).pipe(Atom.withEquality<Api.IssueFilters>(Equal.equals));

/** How many issues match the list's filters, in all and in each state. */
export const issueCounts = TriageApi.runtime.factory.withReactivity(issuesKey)(
  TriageApi.runtime.atom((get) => {
    const query = get(countFilters);

    return TriageApi.use((client) => client.issues.counts({ query })).pipe(
      asDefects,
    );
  }),
);

export type BulkAction =
  { readonly status: Issue.Status } | { readonly label: Api.Label };

/** Apply an action to several issues, then refresh everything showing them. */
export const bulkAction = TriageApi.runtime.fn(
  (input: {
    readonly ids: ReadonlyArray<string>;
    readonly action: BulkAction;
  }) =>
    TriageApi.use((client) =>
      Effect.forEach(
        input.ids,
        (id) =>
          "status" in input.action
            ? client.issues.setStatus({
                params: { id },
                payload: { status: input.action.status },
              })
            : client.issues.setLabel({
                params: { id },
                payload: { label: input.action.label },
              }),
        { concurrency: 4, discard: true },
      ),
    ).pipe(asDefects, Effect.ensuring(Reactivity.invalidate(issuesKey))),
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
