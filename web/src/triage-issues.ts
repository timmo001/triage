import {
  mdiAlertCircleOutline,
  mdiBellOffOutline,
  mdiCheck,
  mdiCheckCircleOutline,
  mdiChevronDown,
  mdiChevronLeft,
  mdiChevronRight,
  mdiClose,
  mdiFilterVariant,
  mdiFilterVariantRemove,
  mdiFormatListGroup,
  mdiListStatus,
  mdiMagnify,
  mdiRefresh,
  mdiRestore,
  mdiServer,
  mdiSortAscending,
  mdiSortDescending,
  mdiTagOutline,
  mdiThumbDownOutline,
  mdiThumbUpOutline,
} from "@mdi/js";
import { WindowVirtualizerController } from "@tanstack/lit-virtual";
import {
  columnGroupingFeature,
  columnVisibilityFeature,
  createColumnHelper,
  createExpandedRowModel,
  createGroupedRowModel,
  FlexRender,
  functionalUpdate,
  type Header,
  type Row,
  type RowSelectionState,
  rowExpandingFeature,
  rowSelectionFeature,
  rowSortingFeature,
  type SortingState,
  TableController,
  tableFeatures,
} from "@tanstack/lit-table";
import { Api, Issue } from "@timmo001/effect-triage";
import { Equal, Predicate, Schema } from "effect";
import { AsyncResult } from "effect/reactivity";
import { css, html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { join } from "lit/directives/join.js";
import { ref } from "lit/directives/ref.js";
import { repeat } from "lit/directives/repeat.js";
import { AtomController, registry } from "./AtomController.js";
import {
  type BulkAction,
  bulkAction,
  collapsedGroups,
  hosts,
  issueCounts,
  issueHref,
  issueList,
  ListSettings,
  listSettings,
} from "./triage.js";
import {
  ago,
  formatPercent,
  formatTime,
  icon,
  renderDefect,
  renderError,
  renderLoading,
  shared,
  stateBadge,
} from "./ui.js";

const features = tableFeatures({
  rowSortingFeature,
  rowSelectionFeature,
  columnGroupingFeature,
  groupedRowModel: createGroupedRowModel(),
  rowExpandingFeature,
  expandedRowModel: createExpandedRowModel(),
  columnVisibilityFeature,
});

type IssueRow = Row<typeof features, Api.IssueSummary>;

const kindTitles: Record<Issue.Kind, string> = {
  Crash: "Crashes",
  UnitFailure: "Unit failures",
  OutOfMemory: "Out of memory",
  LogError: "Log errors",
};

const labelTitles: Record<Api.LabelFilter, string> = {
  worth: "Worth fixing",
  noise: "Noise",
  none: "Not labelled",
};

const sortTitles: Record<Api.IssueSort, string> = {
  lastSeen: "Last seen",
  firstSeen: "First seen",
  worth: "Worth fixing",
  count: "Events",
  title: "Title",
};

const groupTitles: Record<Api.IssueGrouping, string> = {
  state: "State",
  kind: "Kind",
  label: "Label",
};

const dash = html`<span class="muted-text">-</span>`;

const column = createColumnHelper<typeof features, Api.IssueSummary>();

const columns = column.columns([
  column.display({ id: "select", enableSorting: false }),
  column.accessor("state", {
    header: "State",
    enableSorting: false,
    cell: ({ getValue }) => stateBadge(getValue()),
  }),
  column.accessor("title", {
    header: "Issue",
    cell: ({ row: { original: issue } }) => html`
      <a href=${issueHref(issue.id)}>${issue.title}</a>
      <div class="secondary small muted-text">
        ${join(
          [
            stateBadge(issue.state),
            `${issue.count} ${issue.count === 1 ? "event" : "events"}`,
            ago(issue.lastSeen),
            ...(issue.worth === undefined
              ? []
              : [`${formatPercent(issue.worth)} worth fixing`]),
            ...(issue.label === undefined ? [] : [labelTitles[issue.label]]),
            issue.hosts.join(", "),
          ],
          " · ",
        )}
      </div>
    `,
  }),
  column.accessor("kind", { header: "Kind", enableSorting: false }),
  column.accessor((issue) => issue.label ?? "none", {
    id: "label",
    header: "Label",
    enableSorting: false,
    cell: ({ getValue }) =>
      getValue() === "none" ? dash : labelTitles[getValue()],
  }),
  column.accessor((issue) => issue.worth, {
    id: "worth",
    header: "Worth",
    sortDescFirst: true,
    cell: ({ getValue }) => {
      const worth = getValue();

      return worth === undefined ? dash : formatPercent(worth);
    },
  }),
  column.accessor("count", { header: "Events", sortDescFirst: true }),
  column.accessor((issue) => issue.hosts.join(", "), {
    id: "hosts",
    header: "Hosts",
    enableSorting: false,
  }),
  column.accessor("lastSeen", {
    header: "Last seen",
    sortDescFirst: true,
    cell: ({ getValue }) =>
      html`<span title=${formatTime(getValue())}>${ago(getValue())}</span>`,
  }),
  column.accessor("firstSeen", { header: "First seen", sortDescFirst: true }),
]);

/** Columns kept for sorting and grouping, but not shown. */
const columnVisibility = { kind: false, firstSeen: false };

/** The cell classes that align and size each column. */
const cellClasses = new Map([
  ["title", "title"],
  ["label", "small wide"],
  ["worth", "number"],
  ["count", "number"],
  ["hosts", "small wide"],
  ["lastSeen", "when"],
]);

/** How a sorted column reads to assistive tech, and the arrow it shows. */
const sortedAs = {
  asc: ["ascending", " ↑"],
  desc: ["descending", " ↓"],
} as const;

const actions: ReadonlyArray<readonly [string, string, BulkAction]> = [
  ["Resolve", mdiCheckCircleOutline, { status: "resolved" }],
  ["Mute", mdiBellOffOutline, { status: "muted" }],
  ["Reopen", mdiRestore, { status: "open" }],
  ["Worth fixing", mdiThumbUpOutline, { label: "worth" }],
  ["Noise", mdiThumbDownOutline, { label: "noise" }],
];

/** Load the next page once the last drawn row is this close to the end. */
const loadAhead = 10;

const decodeSettings = Schema.decodeUnknownSync(ListSettings);

/**
 * The table state the saved settings control. Kept per settings object, so
 * the table sees the same state until the settings change.
 */
const tableState = new WeakMap<
  ListSettings,
  { readonly sorting: SortingState; readonly grouping: Array<string> }
>();

const tableStateOf = (settings: ListSettings) => {
  const known = tableState.get(settings);

  if (known !== undefined) {
    return known;
  }

  const derived = {
    sorting: [{ id: settings.sort, desc: settings.order === "desc" }],
    grouping: settings.group === undefined ? [] : [settings.group],
  };

  tableState.set(settings, derived);

  return derived;
};

const isKind = Schema.is(Issue.Kind);

const isLabelFilter = Schema.is(Api.LabelFilter);

const groupTitle = (row: IssueRow) => {
  const value = String(row.groupingValue);

  if (row.groupingColumnId === "kind" && isKind(value)) {
    return kindTitles[value];
  }

  if (row.groupingColumnId === "label" && isLabelFilter(value)) {
    return labelTitles[value];
  }

  return value;
};

/** A labelled select for one of the list's settings. */
const select = (
  name: string,
  path: string,
  value: string | undefined,
  options: ReadonlyArray<readonly [string, string]>,
  change: (value: string) => void,
) => html`
  <label>
    <span class="field-name muted-text">${icon(path)}${name}</span>
    <select
      @change=${(event: Event) => {
        if (event.target instanceof HTMLSelectElement) {
          change(event.target.value);
        }
      }}
    >
      ${options.map(
        ([option, title]) => html`
          <option value=${option} ?selected=${option === (value ?? "")}>
            ${title}
          </option>
        `,
      )}
    </select>
  </label>
`;

@customElement("triage-issues")
export class TriageIssues extends LitElement {
  static override styles = [
    shared,
    css`
      .toolbar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.5rem;
        margin: 0.75rem 0;
      }

      select {
        box-sizing: border-box;
        min-height: 2.25rem;
        font: inherit;
        color: inherit;
        background: var(--triage-surface);
        border: 1px solid var(--triage-border);
        border-radius: 0.375rem;
        padding: 0.4rem 0.6rem;
      }

      .search {
        flex: 1 1 14rem;
        display: flex;
        align-items: center;
        gap: 0.4rem;
        padding: 0 0.6rem;
        font-size: inherit;
        color: var(--triage-muted);
        background: var(--triage-surface);
        border: 1px solid var(--triage-border);
        border-radius: 0.375rem;
      }

      .search:focus-within {
        border-color: var(--triage-accent);
      }

      .search input {
        flex: 1;
        min-width: 0;
        padding: 0.35rem 0;
        font: inherit;
        color: var(--triage-text);
        background: none;
        border: 0;
        outline: none;
      }

      .field-name {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
      }

      label {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        font-size: 0.85rem;
      }

      .bar {
        position: sticky;
        top: 0;
        z-index: 2;
        margin-inline: calc(-1 * var(--triage-gutter, 0rem));
        padding: 0.5rem var(--triage-gutter, 0rem);
        background: var(--triage-bg);
        border-bottom: 1px solid var(--triage-border);
      }

      .bar .toolbar {
        flex-wrap: nowrap;
        margin: 0;
      }

      .bar .toolbar > button,
      .search {
        box-sizing: border-box;
        height: 2.25rem;
      }

      .bar .toolbar > button {
        flex: none;
      }

      .bar .toolbar > button.icon-only {
        width: 2.25rem;
        justify-content: center;
      }

      .bar .selection {
        margin: 0.5rem 0 0;
      }

      .list {
        margin-top: 0.75rem;
      }

      .options:popover-open,
      .menu:popover-open {
        box-sizing: border-box;
        margin: 0;
        overflow-y: auto;
        color: inherit;
        background: var(--triage-surface);
        border: 1px solid var(--triage-border);
      }

      .options:popover-open {
        inset: auto 0 0;
        width: 100%;
        max-height: 85vh;
        padding: 1rem;
        border-radius: 0.75rem 0.75rem 0 0;
      }

      .options::backdrop,
      .menu::backdrop {
        background: rgb(0 0 0 / 40%);
      }

      .sheet-head {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }

      .sheet-head > .icon-only {
        background: none;
        border-color: transparent;
      }

      .options .sheet-head h2 {
        flex: 1;
        margin: 0;
        font-size: 1rem;
        text-transform: none;
        letter-spacing: 0;
        color: var(--triage-text);
      }

      .menu:popover-open {
        min-width: 15rem;
        padding: 0.35rem;
        border-radius: 0.5rem;
        box-shadow: 0 0.5rem 1.5rem rgb(0 0 0 / 40%);
      }

      #sort-menu {
        position-anchor: --sort;
      }

      #group-menu {
        position-anchor: --group;
      }

      .menu {
        inset: auto;
        top: calc(anchor(bottom) + 0.25rem);
        left: anchor(left);
        position-try-fallbacks: flip-inline;
      }

      .menu hr {
        margin: 0.25rem 0;
        border: 0;
        border-top: 1px solid var(--triage-border);
      }

      .menu-item {
        display: flex;
        width: 100%;
        min-height: 2.5rem;
        gap: 0.6rem;
        padding: 0.5rem 0.75rem;
        background: none;
        border: 0;
        text-align: start;
      }

      .menu-item:hover {
        background: var(--triage-border);
      }

      .tick,
      .wide-only,
      .narrow-only {
        display: inline-flex;
      }

      .tick {
        width: 1.15em;
      }

      .options h2 {
        display: flex;
        align-items: center;
        gap: 0.4rem;
        margin: 0.75rem 0 0;
        font-size: 0.8rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--triage-muted);
      }

      .options .toolbar {
        flex-direction: column;
        align-items: stretch;
      }

      .options label {
        display: grid;
        grid-template-columns: 5.5rem minmax(0, 1fr);
      }

      .options .toolbar > button {
        justify-content: center;
      }

      .options .states {
        gap: 0.15rem;
      }

      .options .states > .state-option {
        justify-content: flex-start;
        gap: 0.6rem;
        background: none;
        border-color: transparent;
      }

      .options .states > .state-option[aria-pressed="true"] {
        color: var(--triage-text);
        background: var(--triage-surface);
        border-color: var(--triage-accent);
      }

      .state-name {
        flex: 1;
        text-align: start;
        text-transform: capitalize;
      }

      .dot {
        flex: none;
        width: 0.6rem;
        height: 0.6rem;
        border-radius: 50%;
        background: var(--triage-muted);
      }

      .dot.new {
        background: var(--triage-new);
      }

      .dot.regressed {
        background: var(--triage-regressed);
      }

      .dot.ongoing {
        background: var(--triage-ongoing);
      }

      .dot.resolved {
        background: var(--triage-resolved);
      }

      .dot.muted {
        background: var(--triage-muted-state);
      }

      .count {
        min-width: 1.5rem;
        padding: 0.05rem 0.45rem;
        font-size: 0.8rem;
        font-variant-numeric: tabular-nums;
        text-align: center;
        border-radius: 999px;
        background: var(--triage-border);
      }

      .selection {
        padding: 0.5rem 0.75rem;
        background: var(--triage-surface);
        border: 1px solid var(--triage-accent);
        border-radius: 0.5rem;
      }

      .list {
        container-type: inline-size;
        background: var(--triage-surface);
        border: 1px solid var(--triage-border);
        border-radius: 0.5rem;
      }

      .row {
        display: grid;
        grid-template-columns:
          1.5rem 5.5rem minmax(0, 1fr)
          6rem 4rem 4rem minmax(0, 8rem) 8rem;
        gap: 0.75rem;
        align-items: start;
        padding: 0.6rem 0.75rem;
        border-bottom: 1px solid var(--triage-border);
      }

      @container (width < 60rem) {
        .row {
          grid-template-columns: 1.5rem 5.5rem minmax(0, 1fr) 4rem 4rem 8rem;
        }

        .wide {
          display: none;
        }
      }

      .secondary {
        display: none;
        margin-top: 0.25rem;
      }

      .secondary .state {
        min-width: 0;
      }

      @container (width < 40rem) {
        .row {
          grid-template-columns: 1.5rem minmax(0, 1fr);
        }

        .row > [role="cell"]:not(.title),
        .row > [role="columnheader"] {
          display: none;
        }

        .secondary {
          display: block;
        }
      }

      @media (min-width: 40rem) {
        .narrow-only {
          display: none;
        }

        .options:popover-open {
          inset: 0 auto 0 0;
          width: 20rem;
          height: 100%;
          max-height: none;
          border-width: 0 1px 0 0;
          border-radius: 0;
        }
      }

      @media (max-width: 39.99rem) {
        .list {
          margin-inline: calc(-1 * var(--triage-gutter, 0rem));
          border-inline: 0;
          border-radius: 0;
        }

        .search {
          flex-basis: 6rem;
          min-width: 0;
        }

        .bar .toolbar > button {
          width: 2.25rem;
          padding: 0;
          justify-content: center;
          gap: 0;
        }

        .wide-only {
          display: none;
        }

        .menu:popover-open {
          inset: auto 0 0;
          width: 100%;
          max-height: 85vh;
          padding-block: 0.75rem calc(0.75rem + env(safe-area-inset-bottom));
          border-radius: 0.75rem 0.75rem 0 0;
        }
      }

      .head {
        font-size: 0.8rem;
        font-weight: 600;
        color: var(--triage-muted);
      }

      .head button {
        padding: 0;
        border: 0;
        background: none;
        color: inherit;
        font-weight: inherit;
        text-align: inherit;
      }

      .group {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0 0 0 0.75rem;
        font-size: 0.95rem;
        font-weight: 600;
        background: var(--triage-bg);
        border-bottom: 1px solid var(--triage-border);
      }

      .group-name {
        text-transform: capitalize;
      }

      .group-toggle {
        flex: 1;
        gap: 0.5rem;
        padding: 0.65rem 0.75rem 0.65rem 0;
        font-weight: inherit;
        background: none;
        border: 0;
        border-radius: 0;
        text-align: start;
      }

      .group-toggle .icon {
        width: 1.35em;
        height: 1.35em;
        color: var(--triage-accent);
      }

      .group-toggle .muted-text {
        margin-inline-start: auto;
        font-size: 0.85rem;
        font-weight: normal;
      }

      .title a {
        color: inherit;
        text-decoration: none;
        overflow-wrap: anywhere;
      }

      .title a:hover {
        text-decoration: underline;
      }

      .number {
        text-align: right;
        font-variant-numeric: tabular-nums;
      }

      .small {
        font-size: 0.85rem;
      }

      .when {
        white-space: nowrap;
      }
    `,
  ];

  @state() accessor rowSelection: RowSelectionState = {};

  readonly #settings = new AtomController(this, () => listSettings);

  readonly #collapsed = new AtomController(this, () => collapsedGroups);

  readonly #issues = new AtomController(this, () => issueList);

  readonly #counts = new AtomController(this, () => issueCounts);

  readonly #hosts = new AtomController(this, () => hosts);

  readonly #bulk = new AtomController(this, () => bulkAction);

  readonly #table = new TableController<typeof features, Api.IssueSummary>(
    this,
  );

  readonly #virtualizer = new WindowVirtualizerController<HTMLDivElement>(
    this,
    { count: 0, estimateSize: () => 45, overscan: 10 },
  );

  #list: HTMLElement | undefined;

  #search: ReturnType<typeof setTimeout> | undefined;

  /**
   * Change the list settings, dropping any that are cleared. Values come
   * from the page's own controls, and are checked against the schema.
   */
  #update(change: {
    readonly [K in keyof ListSettings]?: string | undefined;
  }) {
    const next = decodeSettings(
      Object.fromEntries(
        Object.entries({ ...this.#settings.value, ...change }).filter(
          ([, value]) => value !== undefined && value !== "",
        ),
      ),
    );

    if (Equal.equals(next, this.#settings.value)) {
      return;
    }

    registry.set(listSettings, next);
    this.rowSelection = {};
  }

  #refresh() {
    registry.refresh(issueList);
    registry.refresh(issueCounts);
    registry.refresh(hosts);
  }

  #renderBar(selected: ReadonlyArray<string>) {
    const settings = this.#settings.value;

    const filtering = [
      settings.state,
      settings.host,
      settings.kind,
      settings.label,
    ].filter((value) => value !== undefined).length;

    return html`
      <div class="toolbar">
        <label class="search">
          ${icon(mdiMagnify)}
          <input
            type="search"
            placeholder="Search titles"
            aria-label="Search titles"
            .value=${settings.search ?? ""}
            @input=${(event: Event) => {
              const input = event.target;

              if (!(input instanceof HTMLInputElement)) {
                return;
              }

              clearTimeout(this.#search);
              this.#search = setTimeout(
                () => this.#update({ search: input.value }),
                300,
              );
            }}
          />
        </label>
        <button
          popovertarget="options"
          aria-label="Filters"
          title="Filters"
          aria-pressed=${filtering > 0}
        >
          ${icon(mdiFilterVariant)}<span class="wide-only">Filters</span>${
            filtering === 0
              ? nothing
              : html`<span class="count">${filtering}</span>`
          }
        </button>
        <button
          popovertarget="sort-menu"
          aria-label="Sort by"
          title="Sort by"
          style="anchor-name: --sort"
        >
          ${icon(settings.order === "asc" ? mdiSortAscending : mdiSortDescending)}<span
            class="wide-only"
            >${sortTitles[settings.sort]}</span
          >
        </button>
        <button
          popovertarget="group-menu"
          aria-label="Group by"
          title="Group by"
          aria-pressed=${settings.group !== undefined}
          style="anchor-name: --group"
        >
          ${icon(mdiFormatListGroup)}<span class="wide-only"
            >${settings.group === undefined ? "Group" : groupTitles[settings.group]}</span
          >
        </button>
        <button
          class="icon-only"
          aria-label="Refresh"
          title="Refresh"
          aria-busy=${this.#issues.value.waiting}
          @click=${() => this.#refresh()}
        >
          ${icon(mdiRefresh)}
        </button>
      </div>
      ${this.#renderMenus()} ${this.#renderSelection(selected)}
    `;
  }

  #renderOptions() {
    const settings = this.#settings.value;
    const counts = AsyncResult.getOrElse(this.#counts.value, () => undefined);
    const known = AsyncResult.getOrElse(this.#hosts.value, () => []);

    const stateOption = (
      state: Issue.State | undefined,
      count: number | undefined,
    ) => html`
      <button
        class="state-option"
        aria-pressed=${state === settings.state}
        @click=${() => this.#update({ state })}
      >
        <span class="dot ${state ?? "all"}"></span>
        <span class="state-name">${state ?? "all"}</span>
        ${count === undefined ? nothing : html`<span class="count">${count}</span>`}
      </button>
    `;

    return html`
      <div id="options" class="options" popover>
        <div class="sheet-head">
          <button
            class="icon-only"
            popovertarget="options"
            popovertargetaction="hide"
            aria-label="Close"
            title="Close"
          >
            <span class="wide-only">${icon(mdiChevronLeft)}</span
            ><span class="narrow-only">${icon(mdiChevronDown)}</span>
          </button>
          <h2>Filters</h2>
          <button
            ?disabled=${
              settings.state === undefined &&
              settings.host === undefined &&
              settings.kind === undefined &&
              settings.label === undefined
            }
            @click=${() =>
              this.#update({
                state: undefined,
                host: undefined,
                kind: undefined,
                label: undefined,
              })}
          >
            ${icon(mdiFilterVariantRemove)} Clear
          </button>
        </div>
        <h2>${icon(mdiListStatus)} State</h2>
        <div class="toolbar states" role="group" aria-label="State">
          ${stateOption(undefined, counts?.total)}
          ${Issue.State.literals.map((state) =>
            stateOption(state, counts?.states[state]),
          )}
        </div>
        <h2>${icon(mdiFilterVariant)} Filter</h2>
        <div class="toolbar">
          ${select(
            "Host",
            mdiServer,
            settings.host,
            [
              ["", "All hosts"],
              ...known.map(
                (host) =>
                  [
                    host.host,
                    `${host.host} (${host.issues} ${host.issues === 1 ? "issue" : "issues"})`,
                  ] as const,
              ),
            ],
            (host) => this.#update({ host }),
          )}
          ${select(
            "Kind",
            mdiAlertCircleOutline,
            settings.kind,
            [["", "All kinds"], ...Object.entries(kindTitles)],
            (kind) => this.#update({ kind }),
          )}
          ${select(
            "Label",
            mdiTagOutline,
            settings.label,
            [["", "Any label"], ...Object.entries(labelTitles)],
            (label) => this.#update({ label }),
          )}
        </div>
      </div>
    `;
  }

  #renderMenus() {
    const settings = this.#settings.value;

    const item = (title: string, checked: boolean, change: () => void) => html`
      <button
        class="menu-item"
        role="menuitemradio"
        aria-checked=${checked}
        @click=${(event: Event) => {
          change();

          const menu =
            event.currentTarget instanceof Element
              ? event.currentTarget.closest("[popover]")
              : null;

          if (menu instanceof HTMLElement) {
            menu.hidePopover();
          }
        }}
      >
        <span class="tick">${checked ? icon(mdiCheck) : nothing}</span>
        ${title}
      </button>
    `;

    return html`
      <div id="sort-menu" class="menu" role="menu" popover>
        ${Object.entries(sortTitles).map(([sort, title]) =>
          item(title, sort === settings.sort, () => this.#update({ sort })),
        )}
        <hr />
        ${item("Ascending", settings.order === "asc", () =>
          this.#update({ order: "asc" }),
        )}
        ${item("Descending", settings.order !== "asc", () =>
          this.#update({ order: "desc" }),
        )}
      </div>
      <div id="group-menu" class="menu" role="menu" popover>
        ${[["", "Nothing"] as const, ...Object.entries(groupTitles)].map(
          ([group, title]) =>
            item(title, group === (settings.group ?? ""), () =>
              this.#update({ group }),
            ),
        )}
      </div>
    `;
  }

  #renderSelection(ids: ReadonlyArray<string>) {
    if (ids.length === 0) {
      return nothing;
    }

    const busy = this.#bulk.value.waiting;

    return html`
      <div class="toolbar selection" role="group" aria-label="Selected issues">
        <span>${ids.length} selected</span>
        ${actions.map(
          ([title, path, action]) => html`
            <button
              ?disabled=${busy}
              @click=${() => {
                registry.set(bulkAction, { ids, action });
                this.rowSelection = {};
              }}
            >
              ${icon(path)} ${title}
            </button>
          `,
        )}
        <button @click=${() => (this.rowSelection = {})}>
          ${icon(mdiClose)} Clear selection
        </button>
      </div>
    `;
  }

  #renderHeader(header: Header<typeof features, Api.IssueSummary>) {
    const sorted = header.column.getIsSorted();

    const [ariaSort, arrow] =
      sorted === false ? (["none", ""] as const) : sortedAs[sorted];

    return html`
      <div
        class=${cellClasses.get(header.column.id) ?? ""}
        role="columnheader"
        aria-sort=${ariaSort}
      >
        ${
          header.column.getCanSort()
            ? html`<button @click=${header.column.getToggleSortingHandler()}>
                ${FlexRender({ header })}${arrow}
              </button>`
            : FlexRender({ header })
        }
      </div>
    `;
  }

  #renderCheckbox(row: IssueRow, label: string) {
    return html`
      <input
        type="checkbox"
        aria-label=${label}
        .checked=${row.getIsSelected()}
        .indeterminate=${row.getIsSomeSelected()}
        @click=${row.getToggleSelectedHandler()}
      />
    `;
  }

  #renderRow(row: IssueRow) {
    if (row.getIsGrouped()) {
      const expanded = row.getIsExpanded();

      return html`
        ${this.#renderCheckbox(row, `Select every loaded ${groupTitle(row)} issue`)}
        <button
          class="group-toggle"
          aria-expanded=${expanded}
          @click=${() => {
            const collapsed = this.#collapsed.value.filter(
              (id) => id !== row.id,
            );

            registry.set(
              collapsedGroups,
              expanded ? [...collapsed, row.id] : collapsed,
            );
          }}
        >
          ${icon(expanded ? mdiChevronDown : mdiChevronRight)}
          <span class="group-name">${groupTitle(row)}</span>
          <span class="muted-text">${row.subRows.length} loaded</span>
        </button>
      `;
    }

    return repeat(
      row.getVisibleCells(),
      (cell) => cell.id,
      (cell) =>
        cell.column.id === "select"
          ? this.#renderCheckbox(row, `Select ${row.original.title}`)
          : html`<div
              class=${cellClasses.get(cell.column.id) ?? ""}
              role="cell"
            >
              ${FlexRender({ cell })}
            </div>`,
    );
  }

  #renderList(issues: Array<Api.IssueSummary>, done: boolean) {
    const settings = this.#settings.value;
    const collapsed = this.#collapsed.value;

    const table = this.#table.table({
      features,
      columns,
      data: issues,
      getRowId: (issue) => issue.id,
      manualSorting: true,
      enableSortingRemoval: false,
      groupedColumnMode: false,
      state: {
        ...tableStateOf(settings),
        rowSelection: this.rowSelection,
        expanded: Object.fromEntries(collapsed.map((id) => [id, false])),
        columnVisibility,
      },
      getIsRowExpanded: (row) => !collapsed.includes(row.id),
      onSortingChange: (updater) => {
        const [next] = functionalUpdate(
          updater,
          tableStateOf(settings).sorting,
        );

        this.#update({
          sort: next?.id,
          order: next?.desc === false ? "asc" : "desc",
        });
      },
      onRowSelectionChange: (updater) => {
        this.rowSelection = functionalUpdate(updater, this.rowSelection);
      },
    });

    const rows = table.getRowModel().rows;
    const virtualizer = this.#virtualizer.getVirtualizer();

    virtualizer.setOptions({
      ...virtualizer.options,
      count: rows.length,
      getItemKey: (index) => rows[index]?.id ?? index,
      scrollMargin: this.#list?.offsetTop ?? 0,
    });

    const items = virtualizer.getVirtualItems();
    const offset = (items[0]?.start ?? 0) - virtualizer.options.scrollMargin;

    return html`
      <div class="list" role="table" aria-rowcount=${rows.length}>
        <div class="row head" role="row">
          <input
            type="checkbox"
            aria-label="Select every loaded issue"
            .checked=${table.getIsAllRowsSelected()}
            .indeterminate=${table.getIsSomeRowsSelected()}
            @click=${table.getToggleAllRowsSelectedHandler()}
          />
          <span class="secondary">Select all</span>
          ${repeat(
            table.getHeaderGroups()[0]?.headers.slice(1) ?? [],
            (header) => header.id,
            (header) => this.#renderHeader(header),
          )}
        </div>
        <div
          ${ref((element) => {
            this.#list = element instanceof HTMLElement ? element : undefined;
          })}
          style="position: relative; height: ${virtualizer.getTotalSize()}px"
          role="rowgroup"
        >
          <div
            style="position: absolute; inset: 0 0 auto; transform: translateY(${offset}px)"
          >
            ${repeat(
              items,
              (item) => item.key,
              (item) => {
                const row = rows[item.index];

                return row === undefined
                  ? nothing
                  : html`
                      <div
                        data-index=${item.index}
                        ${ref((element) => {
                          if (element instanceof HTMLDivElement) {
                            virtualizer.measureElement(element);
                          }
                        })}
                        class=${row.getIsGrouped() ? "group" : "row"}
                        role="row"
                      >
                        ${this.#renderRow(row)}
                      </div>
                    `;
              },
            )}
          </div>
        </div>
      </div>
      ${
        done
          ? nothing
          : html`<p class="muted-text" aria-busy="true">Loading more…</p>`
      }
    `;
  }

  override render() {
    const loaded =
      AsyncResult.getOrElse(this.#issues.value, () => undefined)?.items ?? [];

    const selected = loaded
      .filter((issue) => this.rowSelection[issue.id] === true)
      .map((issue) => issue.id);

    return html`
      <h1>Issues</h1>
      ${this.#renderOptions()}
      <div class="bar">${this.#renderBar(selected)}</div>
      ${AsyncResult.matchWithError(this.#issues.value, {
        onInitial: renderLoading,
        onError: (error) =>
          Predicate.isTagged(error, "NoSuchElementError")
            ? html`<p class="message">No issues here.</p>`
            : renderError(error),
        onDefect: renderDefect,
        onSuccess: ({ value }) => this.#renderList(value.items, value.done),
      })}
    `;
  }

  /** Fetch the next page as the last loaded rows scroll into view. */
  override updated() {
    const result = this.#issues.value;
    const virtualizer = this.#virtualizer.getVirtualizer();
    const last = virtualizer.getVirtualItems().at(-1);

    if (
      AsyncResult.isSuccess(result) &&
      !result.waiting &&
      !result.value.done &&
      last !== undefined &&
      last.index >= virtualizer.options.count - loadAhead
    ) {
      registry.set(issueList, undefined);
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "triage-issues": TriageIssues;
  }
}
