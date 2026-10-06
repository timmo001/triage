import type { Event, Issue } from "@timmo001/effect-triage";
import { Predicate } from "effect";
import { AsyncResult } from "effect/reactivity";
import { css, html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { AtomController, registry } from "./AtomController.js";
import { issue, setStatus } from "./triage.js";
import {
  ago,
  formatTime,
  renderDefect,
  renderError,
  renderLoading,
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
        gap: 0.5rem;
        margin-bottom: 2rem;
      }

      ol {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 0.75rem;
      }

      li {
        padding: 0.75rem 1rem;
        border: 1px solid var(--triage-border);
        border-radius: 0.5rem;
        background: var(--triage-surface);
      }

      li header {
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
    `,
  ];

  @property() accessor issueId = "";

  readonly #detail = new AtomController(this, () => issue(this.issueId));

  readonly #setStatus = new AtomController(this, () => setStatus);

  override render() {
    return html`
      <a class="back" href="#/">All issues</a>
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
          <h2>Latest events</h2>
          <ol>
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
}

const formatFrame = (frame: Event.Frame) =>
  `${frame.function ?? "??"} (${frame.module ?? "unknown"})`;

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
