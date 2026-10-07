import {
  mdiChevronDown,
  mdiChevronRight,
  mdiEyeOutline,
  mdiFilterVariantRemove,
} from "@mdi/js";
import { VirtualizerController } from "@tanstack/lit-virtual";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property, query } from "lit/decorators.js";
import { badge, icon, shared } from "./ui.js";
import "./triage-skeleton.js";

export interface FilterOption {
  readonly value: string;
  readonly title: string;
  /** How many issues have this value, when known. */
  readonly count?: number;
}

const rowHeight = 36;

const shownRows = 4;

const listPadding = 8;

const skeletonWidths = ["7rem", "5rem", "8rem", "6rem"];

/**
 * One of the issue list's filters: a list of options to tick, matching
 * issues with any of them. Every filter is the same height and scrolls its
 * options inside it. Fires `filter-change` with the ticked values, empty
 * when everything is ticked, and `filter-toggle` with whether to show the
 * options.
 *
 * @cssprop --triage-filter-color - The heading's icon colour. Defaults to the accent.
 */
@customElement("triage-filter")
export class TriageFilter extends LitElement {
  static override styles = [
    shared,
    css`
      .header {
        display: flex;
        align-items: center;
        box-sizing: border-box;
        min-height: 2.75rem;
        margin-inline: calc(-1 * var(--triage-filter-inset, 0rem));
        padding-inline: var(--triage-filter-inset, 0rem);
        font-size: 0.95rem;
        font-weight: 600;
        background: var(--triage-bg);
        border-top: 1px solid var(--triage-border);
      }

      :host([expanded]) .header {
        border-bottom: 1px solid var(--triage-border);
      }

      .toggle {
        flex: 1;
        gap: 0.5rem;
        min-height: 2.75rem;
        padding: 0;
        font-weight: inherit;
        background: none;
        border: 0;
        border-radius: 0;
      }

      .toggle > .icon {
        color: var(--triage-filter-color, var(--triage-accent));
      }

      .toggle > .icon:first-child {
        width: 1.35em;
        height: 1.35em;
      }

      .clear {
        background: none;
        border-color: transparent;
      }

      .toggle .badge {
        margin-inline-start: var(--triage-space-1);
        font-variant-numeric: tabular-nums;
        --badge-color: var(--triage-muted);
      }

      .toggle .badge.filtering {
        --badge-color: var(--triage-accent);
      }

      .scroller {
        height: ${shownRows * rowHeight + listPadding * 2}px;
        margin-inline: calc(-1 * var(--triage-filter-inset, 0rem));
        padding-inline: var(--triage-filter-inset, 0rem);
        overflow-y: auto;
        scrollbar-width: thin;
        scrollbar-gutter: stable;
      }

      ul {
        position: relative;
        margin: 0;
        padding: 0;
        list-style: none;
      }

      li {
        position: absolute;
        inset-inline: 0;
        top: 0;
      }

      label,
      .skeleton {
        display: flex;
        align-items: center;
        gap: 0.6rem;
        box-sizing: border-box;
        height: ${rowHeight}px;
        padding: 0 0.25rem 0 2rem;
        border-radius: 0.375rem;
      }

      label {
        cursor: pointer;
      }

      label:hover {
        background: var(--triage-border);
      }

      label:has(input:disabled) {
        cursor: default;
      }

      .title {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
      }

      .count {
        font-size: 0.8rem;
        font-variant-numeric: tabular-nums;
      }

      input {
        width: 1.1rem;
        height: 1.1rem;
        margin: 0;
        accent-color: var(--triage-accent);
      }

      .skeleton {
        justify-content: space-between;
      }

      .skeleton:first-child {
        margin-top: ${listPadding}px;
      }

      .skeleton triage-skeleton {
        width: 1.1rem;
        height: 1.1rem;
        min-height: 0;
      }
    `,
  ];

  @property() accessor label = "";

  /** An `@mdi/js` path shown before the label. */
  @property() accessor path = "";

  @property({ attribute: false })
  accessor options: ReadonlyArray<FilterOption> = [];

  @property({ attribute: false }) accessor value: ReadonlyArray<string> = [];

  /** What clearing the filter goes back to. Everything, unless given. */
  @property({ attribute: false })
  accessor defaultValue: ReadonlyArray<string> = [];

  /** Shows placeholder rows while the options load. */
  @property({ type: Boolean }) accessor loading = false;

  /** Whether the options show. The page decides, from `filter-toggle`. */
  @property({ type: Boolean, reflect: true }) accessor expanded = true;

  @query(".scroller") accessor scroller: HTMLDivElement | null = null;

  readonly #optionList = new VirtualizerController<HTMLDivElement, Element>(
    this,
    {
      count: 0,
      getScrollElement: () => this.scroller,
      estimateSize: () => rowHeight,
      paddingStart: listPadding,
      paddingEnd: listPadding,
      overscan: 4,
    },
  );

  #change(value: ReadonlyArray<string>) {
    this.dispatchEvent(new CustomEvent("filter-change", { detail: value }));
  }

  /** No values means no filter, so every option counts as ticked. */
  #isTicked(option: string) {
    return this.value.length === 0 || this.value.includes(option);
  }

  /** Whether the ticked options differ from the default. */
  #isFiltering() {
    if (this.defaultValue.length === 0) {
      return this.value.length > 0;
    }

    const ticked = this.options.filter(({ value }) => this.#isTicked(value));

    return (
      ticked.length !== this.defaultValue.length ||
      ticked.some(({ value }) => !this.defaultValue.includes(value))
    );
  }

  #toggle(option: string, checked: boolean) {
    const ticked = this.options
      .map(({ value }) => value)
      .filter((value) => (value === option ? checked : this.#isTicked(value)));

    this.#change(ticked.length === this.options.length ? [] : ticked);
  }

  #renderChoices() {
    const virtualizer = this.#optionList.getVirtualizer();

    if (virtualizer.options.count !== this.options.length) {
      virtualizer.setOptions({
        ...virtualizer.options,
        count: this.options.length,
      });
    }

    return html`
      <ul
        aria-label=${this.label}
        style="height: ${virtualizer.getTotalSize()}px"
      >
        ${virtualizer.getVirtualItems().map((item) => {
          const option = this.options[item.index];

          return option === undefined
            ? nothing
            : html`
                <li style="translate: 0 ${item.start}px">
                  <label>
                    <span class="title" title=${option.title}
                      >${option.title}</span
                    >
                    ${
                      option.count === undefined
                        ? nothing
                        : html`<span class="count muted-text"
                            >${option.count}</span
                          >`
                    }
                    <input
                      type="checkbox"
                      .checked=${this.#isTicked(option.value)}
                      ?disabled=${
                        this.#isTicked(option.value) &&
                        (this.value.length || this.options.length) === 1
                      }
                      @change=${(event: Event) => {
                        if (event.target instanceof HTMLInputElement) {
                          this.#toggle(option.value, event.target.checked);
                        }
                      }}
                    />
                  </label>
                </li>
              `;
        })}
      </ul>
    `;
  }

  override render() {
    const shown = this.value.length || this.options.length;
    const filtering = this.#isFiltering();

    return html`
      <div class="header">
        <button
          class="toggle"
          aria-expanded=${this.expanded}
          aria-controls="options"
          @click=${() =>
            this.dispatchEvent(
              new CustomEvent("filter-toggle", { detail: !this.expanded }),
            )}
        >
          ${icon(this.expanded ? mdiChevronDown : mdiChevronRight)}
          ${this.path === "" ? nothing : icon(this.path)} ${this.label}
          ${
            this.loading || this.options.length === 0
              ? nothing
              : html`<span title="${shown} of ${this.options.length} shown"
                  >${badge({
                    path: mdiEyeOutline,
                    content: `${shown}/${this.options.length}`,
                    kind: filtering ? "small filtering" : "small",
                  })}</span
                >`
          }
        </button>
        ${
          filtering
            ? html`<button
                class="clear icon-only"
                aria-label="Clear the ${this.label} filter"
                title="Clear filter"
                @click=${() => this.#change(this.defaultValue)}
              >
                ${icon(mdiFilterVariantRemove)}
              </button>`
            : nothing
        }
      </div>
      <div id="options" class="scroller" ?hidden=${!this.expanded}>
        ${
          this.loading
            ? html`<div role="progressbar" aria-label="Loading ${this.label}">
                ${skeletonWidths.map(
                  (width) => html`
                    <div class="skeleton">
                      <triage-skeleton-text
                        style="--triage-skeleton-text-width: ${width}"
                      ></triage-skeleton-text>
                      <triage-skeleton></triage-skeleton>
                    </div>
                  `,
                )}
              </div>`
            : this.#renderChoices()
        }
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "triage-filter": TriageFilter;
  }

  interface HTMLElementEventMap {
    "filter-change": CustomEvent<ReadonlyArray<string>>;
    "filter-toggle": CustomEvent<boolean>;
  }
}
