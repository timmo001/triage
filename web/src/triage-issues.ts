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
import { Predicate, Schema } from "effect";
import { AsyncResult } from "effect/reactivity";
import { css, html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { ref } from "lit/directives/ref.js";
import { repeat } from "lit/directives/repeat.js";
import { AtomController, registry } from "./AtomController.js";
import {
  type BulkAction,
  bulkAction,
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
    cell: ({ row }) =>
      html`<a href=${issueHref(row.original.id)}>${row.original.title}</a>`,
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

const actions: ReadonlyArray<readonly [string, BulkAction]> = [
  ["Resolve", { status: "resolved" }],
  ["Mute", { status: "muted" }],
  ["Reopen", { status: "open" }],
  ["Worth fixing", { label: "worth" }],
  ["Noise", { label: "noise" }],
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
        margin: 1rem 0;
      }

      [aria-label="State"] button {
        text-transform: capitalize;
      }

      select,
      input[type="search"] {
        font: inherit;
        color: inherit;
        background: var(--triage-surface);
        border: 1px solid var(--triage-border);
        border-radius: 0.375rem;
        padding: 0.3rem 0.5rem;
      }

      input[type="search"] {
        flex: 1 1 14rem;
      }

      label {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        font-size: 0.85rem;
      }

      .selection {
        position: sticky;
        top: 0;
        z-index: 1;
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
          6rem 4rem 4rem minmax(0, 8rem) 7rem;
        gap: 0.75rem;
        align-items: start;
        padding: 0.6rem 0.75rem;
        border-bottom: 1px solid var(--triage-border);
      }

      @container (width < 60rem) {
        .row {
          grid-template-columns: 1.5rem 5.5rem minmax(0, 1fr) 4rem 4rem 7rem;
        }

        .wide {
          display: none;
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
        padding: 0.75rem 0.75rem 0.4rem;
        font-size: 0.85rem;
        font-weight: 600;
        border-bottom: 1px solid var(--triage-border);
      }

      .group-name {
        text-transform: capitalize;
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
    registry.set(
      listSettings,
      decodeSettings(
        Object.fromEntries(
          Object.entries({ ...this.#settings.value, ...change }).filter(
            ([, value]) => value !== undefined && value !== "",
          ),
        ),
      ),
    );
    this.rowSelection = {};
  }

  #refresh() {
    registry.refresh(issueList);
    registry.refresh(issueCounts);
    registry.refresh(hosts);
  }

  #renderFilters() {
    const settings = this.#settings.value;
    const counts = AsyncResult.getOrElse(this.#counts.value, () => undefined);
    const known = AsyncResult.getOrElse(this.#hosts.value, () => []);

    const select = (
      name: string,
      value: string | undefined,
      options: ReadonlyArray<readonly [string, string]>,
      change: (value: string) => void,
    ) => html`
      <label>
        <span class="muted-text">${name}</span>
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

    return html`
      <div class="toolbar" role="group" aria-label="State">
        <button
          aria-pressed=${settings.state === undefined}
          @click=${() => this.#update({ state: undefined })}
        >
          all${counts === undefined ? nothing : ` (${counts.total})`}
        </button>
        ${Issue.State.literals.map(
          (state) => html`
            <button
              aria-pressed=${state === settings.state}
              @click=${() => this.#update({ state })}
            >
              ${state}${
                counts === undefined ? nothing : ` (${counts.states[state]})`
              }
            </button>
          `,
        )}
      </div>
      <div class="toolbar">
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
        ${select(
          "Host",
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
          settings.kind,
          [["", "All kinds"], ...Object.entries(kindTitles)],
          (kind) => this.#update({ kind }),
        )}
        ${select(
          "Label",
          settings.label,
          [["", "Any label"], ...Object.entries(labelTitles)],
          (label) => this.#update({ label }),
        )}
      </div>
      <div class="toolbar">
        ${select("Sort by", settings.sort, Object.entries(sortTitles), (sort) =>
          this.#update({ sort }),
        )}
        <button
          aria-label="Sort direction"
          @click=${() =>
            this.#update({ order: settings.order === "asc" ? "desc" : "asc" })}
        >
          ${settings.order === "asc" ? "Ascending" : "Descending"}
        </button>
        ${select(
          "Group by",
          settings.group,
          [["", "Nothing"], ...Object.entries(groupTitles)],
          (group) => this.#update({ group }),
        )}
        <button
          style="margin-left: auto"
          aria-busy=${this.#issues.value.waiting}
          @click=${() => this.#refresh()}
        >
          Refresh
        </button>
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
          ([title, action]) => html`
            <button
              ?disabled=${busy}
              @click=${() => {
                registry.set(bulkAction, { ids, action });
                this.rowSelection = {};
              }}
            >
              ${title}
            </button>
          `,
        )}
        <button @click=${() => (this.rowSelection = {})}>
          Clear selection
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
      return html`
        ${this.#renderCheckbox(row, `Select every loaded ${groupTitle(row)} issue`)}
        <span class="group-name">${groupTitle(row)}</span>
        <span class="muted-text">${row.subRows.length} loaded</span>
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
        expanded: true,
        columnVisibility,
      },
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
    const loaded = new Set(issues.map((issue) => issue.id));

    const selected = Object.keys(this.rowSelection).filter(
      (id) => this.rowSelection[id] === true && loaded.has(id),
    );

    return html`
      ${this.#renderSelection(selected)}
      <div class="list" role="table" aria-rowcount=${rows.length}>
        <div class="row head" role="row">
          <input
            type="checkbox"
            aria-label="Select every loaded issue"
            .checked=${table.getIsAllRowsSelected()}
            .indeterminate=${table.getIsSomeRowsSelected()}
            @click=${table.getToggleAllRowsSelectedHandler()}
          />
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
    return html`
      <h1>Issues</h1>
      ${this.#renderFilters()}
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
