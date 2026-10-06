import { type Api, Issue } from "@timmo001/effect-triage";
import { AsyncResult } from "effect/reactivity";
import { css, html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { AtomController } from "./AtomController.js";
import { issueHref, issueLimit, issues } from "./triage.js";
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

type Filter = Issue.State | "all";

const filters: ReadonlyArray<Filter> = ["all", ...Issue.State.literals];

type Sort = "recent" | "worth";

const sorts: ReadonlyArray<readonly [Sort, string]> = [
  ["recent", "Last seen"],
  ["worth", "Worth fixing"],
];

const byWorth = (a: Api.IssueSummary, b: Api.IssueSummary) =>
  (b.worth ?? -1) - (a.worth ?? -1);

@customElement("triage-issues")
export class TriageIssues extends LitElement {
  static override styles = [
    shared,
    css`
      .filters {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        margin: 1rem 0;
      }

      .filters .label {
        align-self: center;
        margin-left: auto;
        font-size: 0.85rem;
      }

      [aria-label="State"] button {
        text-transform: capitalize;
      }

      table {
        width: 100%;
        border-collapse: collapse;
        background: var(--triage-surface);
        border: 1px solid var(--triage-border);
        border-radius: 0.5rem;
      }

      th,
      td {
        padding: 0.6rem 0.75rem;
        border-bottom: 1px solid var(--triage-border);
        text-align: left;
        vertical-align: top;
      }

      th {
        font-size: 0.8rem;
        font-weight: 600;
        color: var(--triage-muted);
      }

      td.title a {
        color: inherit;
        text-decoration: none;
        overflow-wrap: anywhere;
      }

      td.title a:hover {
        text-decoration: underline;
      }

      td.count,
      td.worth {
        text-align: right;
        font-variant-numeric: tabular-nums;
      }

      td.when {
        white-space: nowrap;
      }
    `,
  ];

  @state() accessor filter: Filter = "all";

  @state() accessor sort: Sort = "recent";

  readonly #issues = new AtomController(this, () => issues);

  override render() {
    return AsyncResult.matchWithError(this.#issues.value, {
      onInitial: renderLoading,
      onError: renderError,
      onDefect: renderDefect,
      onSuccess: ({ value }) => {
        const counts = new Map<Filter, number>([["all", value.length]]);

        for (const issue of value) {
          counts.set(issue.state, (counts.get(issue.state) ?? 0) + 1);
        }

        const filtered =
          this.filter === "all"
            ? value
            : value.filter((issue) => issue.state === this.filter);

        const shown =
          this.sort === "worth" ? filtered.toSorted(byWorth) : filtered;

        return html`
          <h1>Issues</h1>
          <div class="filters">
            <div class="filters" role="group" aria-label="State">
              ${filters.map(
                (filter) => html`
                  <button
                    aria-pressed=${filter === this.filter}
                    @click=${() => (this.filter = filter)}
                  >
                    ${filter} (${counts.get(filter) ?? 0})
                  </button>
                `,
              )}
            </div>
            <span class="label muted-text">Sort by</span>
            <div class="filters" role="group" aria-label="Sort by">
              ${sorts.map(
                ([sort, label]) => html`
                  <button
                    aria-pressed=${sort === this.sort}
                    @click=${() => (this.sort = sort)}
                  >
                    ${label}
                  </button>
                `,
              )}
            </div>
          </div>
          ${
            shown.length === 0
              ? html`<p class="message">No issues here.</p>`
              : html`
                  <table>
                    <thead>
                      <tr>
                        <th>State</th>
                        <th>Issue</th>
                        <th
                          title="How likely the latest decision says it's worth fixing"
                        >
                          Worth
                        </th>
                        <th>Events</th>
                        <th>Last seen</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${shown.map(
                        (issue) => html`
                          <tr>
                            <td>${stateBadge(issue.state)}</td>
                            <td class="title">
                              <a href=${issueHref(issue.id)}>${issue.title}</a>
                            </td>
                            <td class="worth">
                              ${
                                issue.worth === undefined
                                  ? html`<span class="muted-text">-</span>`
                                  : formatPercent(issue.worth)
                              }
                            </td>
                            <td class="count">${issue.count}</td>
                            <td
                              class="when"
                              title=${formatTime(issue.lastSeen)}
                            >
                              ${ago(issue.lastSeen)}
                            </td>
                          </tr>
                        `,
                      )}
                    </tbody>
                  </table>
                `
          }
          ${
            value.length === issueLimit
              ? html`<p class="muted-text">
                  Showing the ${issueLimit} most recent issues.
                </p>`
              : null
          }
        `;
      },
    });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "triage-issues": TriageIssues;
  }
}
