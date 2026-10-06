import {
  mdiChevronDown,
  mdiChevronRight,
  mdiFilterVariantRemove,
} from "@mdi/js";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { icon, shared } from "./ui.js";

export interface FilterOption {
  readonly value: string;
  readonly title: string;
  /** How many issues have this value, when known. */
  readonly count?: number;
}

/**
 * One of the issue list's filters: a panel of options to tick, matching
 * issues with any of them. Fires `filter-change` with the ticked values.
 */
@customElement("triage-filter")
export class TriageFilter extends LitElement {
  static override styles = [
    shared,
    css`
      .header {
        display: flex;
        align-items: center;
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
        padding: 0.65rem 0;
        font-weight: inherit;
        background: none;
        border: 0;
        border-radius: 0;
      }

      .toggle > .icon:first-child {
        width: 1.35em;
        height: 1.35em;
        color: var(--triage-accent);
      }

      .clear {
        background: none;
        border-color: transparent;
      }

      .badge {
        min-width: 1.25rem;
        padding: 0 0.35rem;
        font-size: 0.75rem;
        font-weight: normal;
        text-align: center;
        color: var(--triage-bg);
        background: var(--triage-accent);
        border-radius: 999px;
      }

      ul {
        margin: 0.5rem 0;
        padding: 0;
        list-style: none;
      }

      label {
        display: flex;
        align-items: center;
        gap: 0.6rem;
        min-height: 2.25rem;
        padding: 0 0.25rem 0 2rem;
        border-radius: 0.375rem;
        cursor: pointer;
      }

      label:hover {
        background: var(--triage-border);
      }

      .title {
        flex: 1;
        min-width: 0;
        overflow-wrap: anywhere;
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
    `,
  ];

  @property() accessor label = "";

  /** An `@mdi/js` path shown before the label. */
  @property() accessor path = "";

  @property({ attribute: false })
  accessor options: ReadonlyArray<FilterOption> = [];

  @property({ attribute: false }) accessor value: ReadonlyArray<string> = [];

  @property({ type: Boolean, reflect: true }) accessor expanded = true;

  #change(value: ReadonlyArray<string>) {
    this.dispatchEvent(new CustomEvent("filter-change", { detail: value }));
  }

  #toggle(option: string, checked: boolean) {
    this.#change(
      this.options
        .map(({ value }) => value)
        .filter((value) =>
          value === option ? checked : this.value.includes(value),
        ),
    );
  }

  override render() {
    return html`
      <div class="header">
        <button
          class="toggle"
          aria-expanded=${this.expanded}
          aria-controls="options"
          @click=${() => {
            this.expanded = !this.expanded;
          }}
        >
          ${icon(this.expanded ? mdiChevronDown : mdiChevronRight)}
          ${this.path === "" ? nothing : icon(this.path)} ${this.label}
          ${
            this.value.length === 0
              ? nothing
              : html`<span class="badge">${this.value.length}</span>`
          }
        </button>
        ${
          this.value.length === 0
            ? nothing
            : html`<button
                class="clear icon-only"
                aria-label="Clear ${this.label}"
                title="Clear"
                @click=${() => this.#change([])}
              >
                ${icon(mdiFilterVariantRemove)}
              </button>`
        }
      </div>
      <ul id="options" aria-label=${this.label} ?hidden=${!this.expanded}>
        ${repeat(
          this.options,
          (option) => option.value,
          (option) => html`
            <li>
              <label>
                <span class="title">${option.title}</span>
                ${
                  option.count === undefined
                    ? nothing
                    : html`<span class="count muted-text"
                        >${option.count}</span
                      >`
                }
                <input
                  type="checkbox"
                  .checked=${this.value.includes(option.value)}
                  @change=${(event: Event) => {
                    if (event.target instanceof HTMLInputElement) {
                      this.#toggle(option.value, event.target.checked);
                    }
                  }}
                />
              </label>
            </li>
          `,
        )}
      </ul>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "triage-filter": TriageFilter;
  }

  interface HTMLElementEventMap {
    "filter-change": CustomEvent<ReadonlyArray<string>>;
  }
}
