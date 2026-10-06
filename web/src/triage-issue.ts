import type { Api, Event, Issue } from "@timmo001/effect-triage";
import DOMPurify from "dompurify";
import { Predicate } from "effect";
import { AsyncResult } from "effect/reactivity";
import { css, html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { marked } from "marked";
import { AtomController, registry } from "./AtomController.js";
import { homeHref, issue, setLabel, setStatus } from "./triage.js";
import {
  ago,
  formatPercent,
  formatTime,
  renderDefect,
  renderError,
  renderLoading,
  severityLabel,
  shared,
  stateBadge,
} from "./ui.js";

const actions: Record<
  Issue.State,
  ReadonlyArray<readonly [label: string, status: Issue.Status]>
> = {
  new: [
    ["Resolve", "resolved"],
    ["Mute", "muted"],
  ],
  ongoing: [
    ["Resolve", "resolved"],
    ["Mute", "muted"],
  ],
  regressed: [
    ["Resolve", "resolved"],
    ["Mute", "muted"],
  ],
  resolved: [["Reopen", "open"]],
  muted: [["Unmute", "open"]],
};

const labels: ReadonlyArray<readonly [text: string, label: Api.Label]> = [
  ["Worth fixing", "worth"],
  ["Noise", "noise"],
];

const kinds: Record<Issue.Kind, string> = {
  Crash: "Crash",
  UnitFailure: "Unit failure",
  OutOfMemory: "Out of memory",
  LogError: "Log error",
};

@customElement("triage-issue")
export class TriageIssue extends LitElement {
  static override styles = [
    shared,
    css`
      .back {
        display: inline-block;
        margin-top: 1rem;
      }

      h1 {
        overflow-wrap: anywhere;
      }

      dl {
        display: grid;
        grid-template-columns: max-content 1fr;
        gap: 0.4rem 1.5rem;
        margin: 0 0 1rem;
      }

      dt {
        color: var(--triage-muted);
      }

      dd {
        margin: 0;
      }

      .actions {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin-bottom: 2rem;
      }

      .cards {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 0.75rem;
      }

      .cards > li {
        padding: 0.75rem 1rem;
        border: 1px solid var(--triage-border);
        border-radius: 0.5rem;
        background: var(--triage-surface);
      }

      .cards > li > header {
        display: flex;
        flex-wrap: wrap;
        gap: 0.25rem 1rem;
        font-size: 0.85rem;
        color: var(--triage-muted);
      }

      pre {
        margin: 0.5rem 0 0;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        font-size: 0.85rem;
      }

      details {
        margin-top: 0.5rem;
        font-size: 0.85rem;
      }

      table {
        width: 100%;
        border-collapse: collapse;
        margin-bottom: 2rem;
        background: var(--triage-surface);
        border: 1px solid var(--triage-border);
        border-radius: 0.5rem;
      }

      th,
      td {
        padding: 0.5rem 0.75rem;
        border-bottom: 1px solid var(--triage-border);
        text-align: left;
      }

      th {
        font-size: 0.8rem;
        font-weight: 600;
        color: var(--triage-muted);
      }

      td.worth {
        font-variant-numeric: tabular-nums;
      }

      td.cause {
        text-transform: capitalize;
      }

      .suggestions {
        margin-bottom: 2rem;
      }

      .suggestion {
        overflow-wrap: anywhere;
      }

      .suggestion :is(h1, h2, h3, h4, h5, h6) {
        margin: 1rem 0 0.5rem;
        font-size: 1rem;
      }

      .suggestion pre {
        overflow-x: auto;
        white-space: pre;
        padding: 0.5rem 0.75rem;
        border-radius: 0.4rem;
        background: var(--triage-bg);
      }
    `,
  ];

  @property() accessor issueId = "";

  readonly #detail = new AtomController(this, () => issue(this.issueId));

  readonly #setStatus = new AtomController(this, () => setStatus);

  readonly #setLabel = new AtomController(this, () => setLabel);

  override render() {
    return html`
      <a class="back" href=${homeHref}>All issues</a>
      ${AsyncResult.matchWithError(this.#detail.value, {
        onInitial: renderLoading,
        onError: renderError,
        onDefect: renderDefect,
        onSuccess: ({ value }) => html`
          <h1>${value.issue.title}</h1>
          <dl>
            <dt>State</dt>
            <dd>${stateBadge(value.issue.state)}</dd>
            <dt>Kind</dt>
            <dd>${kinds[value.issue.kind]}</dd>
            <dt>Events</dt>
            <dd>${value.issue.count}</dd>
            <dt>First seen</dt>
            <dd title=${formatTime(value.issue.firstSeen)}>
              ${ago(value.issue.firstSeen)}
            </dd>
            <dt>Last seen</dt>
            <dd title=${formatTime(value.issue.lastSeen)}>
              ${ago(value.issue.lastSeen)}
            </dd>
            <dt>Hosts</dt>
            <dd>
              ${[...new Set(value.events.map((event) => event.host))].join(
                ", ",
              )}
            </dd>
          </dl>
          <div class="actions">
            ${actions[value.issue.state].map(
              ([label, status]) => html`
                <button
                  ?disabled=${this.#setStatus.value.waiting}
                  @click=${() => this.#changeStatus(value.issue.id, status)}
                >
                  ${label}
                </button>
              `,
            )}
          </div>
          <h2>Decisions</h2>
          ${renderDecisions(value.decisions)}
          <div class="actions" role="group" aria-label="Your label">
            <span class="muted-text">Your label</span>
            ${labels.map(
              ([text, label]) => html`
                <button
                  aria-pressed=${value.label === label}
                  ?disabled=${this.#setLabel.value.waiting}
                  @click=${() => this.#changeLabel(value.issue.id, label)}
                >
                  ${text}
                </button>
              `,
            )}
          </div>
          <h2>Suggested fixes</h2>
          ${renderSuggestions(value.suggestions)}
          <h2>Latest events</h2>
          <ol class="cards">
            ${value.events.map(renderEvent)}
          </ol>
        `,
      })}
    `;
  }

  #changeStatus(id: string, status: Issue.Status) {
    registry.set(setStatus, {
      params: { id },
      payload: { status },
      reactivityKeys: ["issues"],
    });
  }

  #changeLabel(id: string, label: Api.Label) {
    registry.set(setLabel, {
      params: { id },
      payload: { label },
      reactivityKeys: ["issues"],
    });
  }
}

const formatFrame = (frame: Event.Frame) =>
  `${frame.function ?? "??"} (${frame.module ?? "unknown"})`;

const renderDecisions = (decisions: ReadonlyArray<Api.IssueDecision>) =>
  decisions.length === 0
    ? html`<p class="muted-text">No decision model has looked at it yet.</p>`
    : html`
        <table>
          <thead>
            <tr>
              <th>Model</th>
              <th>Worth fixing</th>
              <th>Severity</th>
              <th>Likely cause</th>
              <th>Decided by</th>
              <th>Decided</th>
            </tr>
          </thead>
          <tbody>
            ${decisions.map(
              (decision) => html`
                <tr>
                  <td>${decision.model}</td>
                  <td class="worth">${formatPercent(decision.worth)}</td>
                  <td>${severityLabel(decision.severity)}</td>
                  <td class="cause">${decision.cause}</td>
                  <td>${decision.by ?? "unknown"}</td>
                  <td title=${formatTime(decision.decidedAt)}>
                    ${ago(decision.decidedAt)}, at ${decision.issueCount}
                    ${decision.issueCount === 1 ? "event" : "events"}
                  </td>
                </tr>
              `,
            )}
          </tbody>
        </table>
      `;

// The text comes from a language model, so it's sanitised before rendering,
// without images so it can't make the browser fetch anything.
const markdown = (text: string) =>
  unsafeHTML(
    DOMPurify.sanitize(marked.parse(text, { async: false }), {
      FORBID_TAGS: ["img"],
      FORBID_ATTR: ["style"],
    }),
  );

const renderSuggestions = (suggestions: ReadonlyArray<Api.IssueSuggestion>) =>
  suggestions.length === 0
    ? html`<p class="muted-text">No language model has suggested a fix yet.</p>`
    : html`
        <ol class="cards suggestions">
          ${suggestions.map(
            (suggestion) => html`
              <li>
                <header>
                  <span>${suggestion.model}</span>
                  ${
                    suggestion.by === null
                      ? ""
                      : html`<span>by ${suggestion.by}</span>`
                  }
                  <time title=${formatTime(suggestion.suggestedAt)}>
                    ${ago(suggestion.suggestedAt)}
                  </time>
                  <span>
                    at ${suggestion.issueCount}
                    ${suggestion.issueCount === 1 ? "event" : "events"}
                  </span>
                </header>
                <div class="suggestion">${markdown(suggestion.text)}</div>
              </li>
            `,
          )}
        </ol>
      `;

const renderEvent = (event: Event.Event) => html`
  <li>
    <header>
      <time title=${formatTime(event.timestamp)}>${ago(event.timestamp)}</time>
      <span>${event.host}</span>
      <span>${event.severity}</span>
      ${event.unit === undefined ? null : html`<span>${event.unit}</span>`}
    </header>
    <pre>${event.message}</pre>
    ${
      Predicate.isTagged(event, "Crash") && event.frames.length > 0
        ? html`<details>
            <summary>Stack trace</summary>
            <pre>${event.frames.map(formatFrame).join("\n")}</pre>
          </details>`
        : null
    }
    ${
      event.breadcrumbs === undefined || event.breadcrumbs.length === 0
        ? null
        : html`<details>
            <summary>What it logged before</summary>
            <pre>${event.breadcrumbs.join("\n")}</pre>
          </details>`
    }
  </li>
`;

declare global {
  interface HTMLElementTagNameMap {
    "triage-issue": TriageIssue;
  }
}
