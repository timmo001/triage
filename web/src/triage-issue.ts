import {
  type Api,
  Event,
  type Issue,
  type Severity,
} from "@timmo001/effect-triage";
import {
  mdiAlertCircleOutline,
  mdiAlertOctagonOutline,
  mdiAlertOutline,
  mdiApplicationOutline,
  mdiBellOffOutline,
  mdiBellOutline,
  mdiBugOutline,
  mdiCheckCircleOutline,
  mdiChevronLeft,
  mdiChevronRight,
  mdiChip,
  mdiClockOutline,
  mdiCogOutline,
  mdiContentCopy,
  mdiExitToApp,
  mdiFileCogOutline,
  mdiHistory,
  mdiInformationOutline,
  mdiLayersTripleOutline,
  mdiLightningBolt,
  mdiLinux,
  mdiNotebookOutline,
  mdiPackageVariantClosed,
  mdiPower,
  mdiRestore,
  mdiServer,
  mdiSkullOutline,
  mdiThumbDownOutline,
  mdiThumbUpOutline,
} from "@mdi/js";
import DOMPurify from "dompurify";
import { Predicate } from "effect";
import { AsyncResult } from "effect/reactivity";
import { css, html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { marked } from "marked";
import { AtomController, registry } from "./AtomController.js";
import { homeHref, issue, setLabel, setStatus } from "./triage.js";
import {
  ago,
  badge,
  dragScroll,
  formatPercent,
  formatTime,
  icon,
  renderDefect,
  renderError,
  renderLoading,
  severityLabel,
  shared,
  stateBadge,
} from "./ui.js";

const actions: Record<
  Issue.State,
  ReadonlyArray<readonly [label: string, status: Issue.Status, icon: string]>
> = {
  new: [
    ["Resolve", "resolved", mdiCheckCircleOutline],
    ["Mute", "muted", mdiBellOffOutline],
  ],
  ongoing: [
    ["Resolve", "resolved", mdiCheckCircleOutline],
    ["Mute", "muted", mdiBellOffOutline],
  ],
  quiet: [
    ["Resolve", "resolved", mdiCheckCircleOutline],
    ["Mute", "muted", mdiBellOffOutline],
  ],
  regressed: [
    ["Resolve", "resolved", mdiCheckCircleOutline],
    ["Mute", "muted", mdiBellOffOutline],
  ],
  resolved: [["Reopen", "open", mdiRestore]],
  muted: [["Unmute", "open", mdiBellOutline]],
};

const labels: ReadonlyArray<
  readonly [text: string, label: Api.Label, icon: string]
> = [
  ["Worth fixing", "worth", mdiThumbUpOutline],
  ["Noise", "noise", mdiThumbDownOutline],
];

const kinds: Record<Issue.Kind, string> = {
  Crash: "Crash",
  UnitFailure: "Unit failure",
  OutOfMemory: "Out of memory",
  LogError: "Log error",
};

/** What to paste into an agent so it reads the issue through triage's MCP server. */
const agentMessage = (issue: Issue.Issue) =>
  `Triage issue ${issue.id}, ${issue.title}: ${location.href}\n\nRead it and all its events with the triage MCP server's get_issue and get_issue_events tools.`;

@customElement("triage-issue")
export class TriageIssue extends LitElement {
  static override styles = [
    shared,
    css`
      .back {
        display: inline-flex;
        align-items: center;
        gap: var(--triage-space-1);
        margin-top: var(--triage-space-4);
        margin-inline-start: calc(-1 * var(--triage-space-1));
        text-decoration: none;
      }

      .back:hover span {
        text-decoration: underline;
      }

      h1 {
        overflow-wrap: anywhere;
      }

      dl {
        display: grid;
        grid-template-columns: max-content 1fr;
        gap: var(--triage-space-1-5) var(--triage-space-6);
        margin: 0 0 var(--triage-space-4);
      }

      dt {
        color: var(--triage-muted);
      }

      dd {
        margin: 0;
      }

      .hosts {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: var(--triage-space-1);
      }

      .hosts .muted-text {
        margin-left: var(--triage-space-2);
        font-size: var(--triage-font-size-s);
      }

      .actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--triage-space-2);
        margin-bottom: var(--triage-space-8);
      }

      .actions.status {
        margin-bottom: var(--triage-space-3);
      }

      .cards {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: var(--triage-space-3);
      }

      .cards > li {
        min-width: 0;
        padding: var(--triage-space-3) var(--triage-space-4);
        border: var(--triage-border-width) solid var(--triage-border);
        border-radius: var(--triage-border-radius-md);
        background: var(--triage-surface);
      }

      .cards > li > header {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--triage-space-1) var(--triage-space-4);
        font-size: var(--triage-font-size-s);
        color: var(--triage-muted);
      }

      .cards .badge {
        background: var(--triage-bg);
      }

      .severity {
        text-transform: capitalize;
      }

      .severity.emerg,
      .severity.alert,
      .severity.crit,
      .severity.err {
        --badge-color: var(--triage-regressed);
      }

      .severity.warning {
        --badge-color: var(--triage-ongoing);
      }

      .severity.notice,
      .severity.info {
        --badge-color: var(--triage-new);
      }

      .severity.debug {
        --badge-color: var(--triage-muted);
      }

      pre {
        margin: var(--triage-space-2) 0 0;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        font-size: var(--triage-font-size-s);
      }

      .agent {
        display: block;
        max-width: 36rem;
        margin-bottom: var(--triage-space-8);
        padding: var(--triage-space-1-5) var(--triage-space-2);
        text-align: start;
        background: var(--triage-bg);
      }

      .agent:hover {
        border-color: var(--triage-accent);
      }

      .agent .muted-text {
        display: inline-flex;
        align-items: center;
        gap: var(--triage-space-1);
        font-size: var(--triage-font-size-xs);
      }

      .agent pre {
        margin-top: var(--triage-space-1);
        font-size: inherit;
      }

      .agent pre,
      .agent code {
        font-family: inherit;
      }

      details {
        margin-top: var(--triage-space-3);
        border: var(--triage-border-width) solid var(--triage-border);
        border-radius: var(--triage-border-radius-sm);
      }

      summary {
        display: flex;
        align-items: center;
        gap: var(--triage-space-1);
        padding: var(--triage-space-1-5) var(--triage-space-2);
        cursor: pointer;
        list-style: none;
        user-select: none;
      }

      summary .preview {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
        color: var(--triage-muted);
      }

      summary:hover .preview {
        color: inherit;
      }

      summary::-webkit-details-marker {
        display: none;
      }

      summary:hover {
        color: var(--triage-accent);
      }

      summary .icon {
        color: var(--triage-accent);
      }

      summary .icon:first-child {
        color: var(--triage-muted);
        transition: transform var(--triage-duration-fast);
      }

      details[open] summary .icon:first-child {
        transform: rotate(90deg);
      }

      details pre {
        margin: 0;
        padding: var(--triage-space-2) var(--triage-space-3);
        border-top: var(--triage-border-width) solid var(--triage-border);
        max-height: 24rem;
        overflow: auto;
      }

      .event-fields {
        display: flex;
        gap: var(--triage-space-1-5);
        overflow-x: auto;
        overscroll-behavior-x: contain;
        scrollbar-width: none;
        mask-image: linear-gradient(
          to right,
          transparent,
          black var(--triage-scroll-fade-start),
          black calc(100% - var(--triage-scroll-fade-end)),
          transparent
        );
        animation: scroll-fade linear both;
        animation-timeline: scroll(self inline);
      }

      .event-fields > .badge {
        flex: none;
        max-width: none;
      }

      .event-fields {
        container-type: scroll-state;
      }

      @container scroll-state(scrollable: inline) {
        .event-fields > .badge {
          cursor: grab;
        }
      }

      .event-fields.dragging {
        user-select: none;
      }

      .event-fields.dragging > .badge {
        cursor: grabbing;
      }

      @keyframes scroll-fade {
        from {
          --triage-scroll-fade-end: var(--triage-space-8);
        }

        10% {
          --triage-scroll-fade-start: var(--triage-space-8);
        }

        90% {
          --triage-scroll-fade-end: var(--triage-space-8);
        }

        to {
          --triage-scroll-fade-start: var(--triage-space-8);
        }
      }

      .event-severity {
        display: flex;
        align-items: center;
        gap: var(--triage-space-1);
        font-size: var(--triage-font-size-s);
        font-weight: var(--triage-font-weight-semibold);
        color: var(--badge-color);
      }

      .event-message {
        margin-top: var(--triage-space-1);
        font-family: inherit;
        font-size: var(--triage-font-size-l);
        font-weight: var(--triage-font-weight-medium);
      }

      .event-time {
        display: flex;
        align-items: center;
        gap: var(--triage-space-1);
        margin: var(--triage-space-1) 0 var(--triage-space-3);
        font-size: var(--triage-font-size-s);
        color: var(--triage-muted);
      }

      table {
        width: 100%;
        border-collapse: collapse;
        margin-bottom: var(--triage-space-8);
        background: var(--triage-surface);
        border: var(--triage-border-width) solid var(--triage-border);
        border-radius: var(--triage-border-radius-md);
      }

      th,
      td {
        padding: var(--triage-space-2) var(--triage-space-3);
        border-bottom: var(--triage-border-width) solid var(--triage-border);
        text-align: left;
      }

      th {
        font-size: var(--triage-font-size-xs);
        font-weight: var(--triage-font-weight-semibold);
        color: var(--triage-muted);
      }

      td.worth {
        font-variant-numeric: tabular-nums;
      }

      td.cause {
        text-transform: capitalize;
      }

      .suggestions {
        margin-bottom: var(--triage-space-8);
      }

      .suggestion {
        overflow-wrap: anywhere;
      }

      .suggestion :is(h1, h2, h3, h4, h5, h6) {
        margin: var(--triage-space-4) 0 var(--triage-space-2);
        font-size: var(--triage-font-size-m);
      }

      .suggestion pre {
        overflow-x: auto;
        white-space: pre;
        padding: var(--triage-space-2) var(--triage-space-3);
        border-radius: var(--triage-border-radius-sm);
        background: var(--triage-bg);
      }
    `,
  ];

  @property() accessor issueId = "";

  @state() accessor copied = false;

  readonly #detail = new AtomController(this, () => issue(this.issueId));

  readonly #setStatus = new AtomController(this, () => setStatus);

  readonly #setLabel = new AtomController(this, () => setLabel);

  override render() {
    return html`
      <a class="back" href=${homeHref}
        >${icon(mdiChevronLeft)}<span>All issues</span></a
      >
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
            <dd>${renderHosts(value.hosts)}</dd>
          </dl>
          <div class="actions status">
            ${actions[value.issue.state].map(
              ([label, status, path]) => html`
                <button
                  ?disabled=${this.#setStatus.value.waiting}
                  @click=${() => this.#changeStatus(value.issue.id, status)}
                >
                  ${icon(path)} ${label}
                </button>
              `,
            )}
          </div>
          <button class="agent" @click=${() => this.#copyForAgent(value.issue)}>
            <span class="muted-text">
              ${icon(mdiContentCopy)}
              ${this.copied ? "Copied" : "Copy for agent"}
            </span>
            <pre><code>${agentMessage(value.issue)}</code></pre>
          </button>
          <h2>Decisions</h2>
          ${renderDecisions(value.decisions)}
          <div class="actions" role="group" aria-label="Your label">
            <span class="muted-text">Your label</span>
            ${labels.map(
              ([text, label, path]) => html`
                <button
                  aria-pressed=${value.label === label}
                  ?disabled=${this.#setLabel.value.waiting}
                  @click=${() => this.#changeLabel(value.issue.id, label)}
                >
                  ${icon(path)} ${text}
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

  #copyTimer: ReturnType<typeof setTimeout> | undefined;

  async #copyForAgent(issue: Issue.Issue) {
    await navigator.clipboard.writeText(agentMessage(issue));

    this.copied = true;
    clearTimeout(this.#copyTimer);
    this.#copyTimer = setTimeout(() => {
      this.copied = false;
    }, 2000);
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

const renderHosts = (hosts: ReadonlyArray<Api.HostCount>) => html`
  <ul class="hosts">
    ${hosts.map(
      (host) => html`
        <li>
          <strong>${host.host}</strong>
          <span class="muted-text">
            ${host.count} ${host.count === 1 ? "event" : "events"}, first
            <span title=${formatTime(host.firstSeen)}
              >${ago(host.firstSeen)}</span
            >, last
            <span title=${formatTime(host.lastSeen)}
              >${ago(host.lastSeen)}</span
            >
          </span>
        </li>
      `,
    )}
  </ul>
`;

type Field = readonly [label: string, icon: string, value?: string];

// Everything stored about where an event came from, in the order people look
// for it.
const eventFields = (event: Event.Event) => {
  const fields: ReadonlyArray<Field> = [
    ["Host", mdiServer, event.host],
    ["Source", mdiNotebookOutline, event.source],
    ["Program", mdiApplicationOutline, event.identifier],
    [
      "Unit",
      mdiCogOutline,
      event.unit === undefined || event.scope === undefined
        ? event.unit
        : `${event.unit} (${event.scope})`,
    ],
    ...Event.Event.match<ReadonlyArray<Field>>(event, {
      Crash: (crash) => [
        ["Executable", mdiFileCogOutline, crash.executable],
        ["Signal", mdiLightningBolt, crash.signal],
      ],
      UnitFailure: (failure) => [["Result", mdiExitToApp, failure.result]],
      OutOfMemory: (oom) => [["Killed", mdiSkullOutline, oom.process]],
      LogError: () => [],
    }),
    [
      "Package",
      mdiPackageVariantClosed,
      event.package === undefined
        ? undefined
        : `${event.package.name} ${event.package.version}`,
    ],
    ["OS", mdiLinux, event.system?.os],
    ["Kernel", mdiChip, event.system?.kernel],
    ["Boot", mdiPower, event.bootId],
  ];

  return fields.flatMap(([label, path, value]) =>
    value === undefined ? [] : [[label, path, value] as const],
  );
};

const severityIcons: Record<Severity.Severity, string> = {
  emerg: mdiAlertOctagonOutline,
  alert: mdiAlertOctagonOutline,
  crit: mdiAlertOctagonOutline,
  err: mdiAlertCircleOutline,
  warning: mdiAlertOutline,
  notice: mdiInformationOutline,
  info: mdiInformationOutline,
  debug: mdiBugOutline,
};

const renderEvent = (event: Event.Event) => html`
  <li>
    <div class="event-severity severity ${event.severity}">
      ${icon(severityIcons[event.severity])} ${event.severity}
    </div>
    <pre class="event-message">${event.message}</pre>
    <time class="event-time" title=${formatTime(event.timestamp)}
      >${icon(mdiClockOutline)} ${ago(event.timestamp)}</time
    >
    <div class="event-fields" @pointerdown=${dragScroll}>
      ${eventFields(event).map(([label, path, value]) =>
        badge({ path, label, content: value, kind: "dense" }),
      )}
    </div>
    ${
      Predicate.isTagged(event, "Crash") && event.frames.length > 0
        ? html`<details>
            <summary title="Stack trace" aria-label="Stack trace">
              ${icon(mdiChevronRight)} ${icon(mdiLayersTripleOutline)}
              <code class="preview">${formatFrame(event.frames[0])}</code>
            </summary>
            <pre><code>${event.frames.map(formatFrame).join("\n")}</code></pre>
          </details>`
        : null
    }
    ${
      event.breadcrumbs === undefined || event.breadcrumbs.length === 0
        ? null
        : html`<details>
            <summary
              title="What it logged before"
              aria-label="What it logged before"
            >
              ${icon(mdiChevronRight)} ${icon(mdiHistory)}
              <code class="preview">${event.breadcrumbs.at(-1)}</code>
            </summary>
            <pre><code>${event.breadcrumbs.join("\n")}</code></pre>
          </details>`
    }
  </li>
`;

declare global {
  interface HTMLElementTagNameMap {
    "triage-issue": TriageIssue;
  }
}
