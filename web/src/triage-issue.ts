import { Api, Event, type Issue, type Severity } from "@timmo001/effect-triage";
import {
  mdiAlertCircleOutline,
  mdiAlertDecagramOutline,
  mdiAlertOctagonOutline,
  mdiAlertOutline,
  mdiApplicationOutline,
  mdiBellOffOutline,
  mdiBellOutline,
  mdiBugOutline,
  mdiCallSplit,
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
  mdiNoteTextOutline,
  mdiPackageVariantClosed,
  mdiPower,
  mdiPuzzleOutline,
  mdiRefresh,
  mdiRestore,
  mdiServer,
  mdiSkullOutline,
  mdiThumbDownOutline,
  mdiThumbUpOutline,
} from "@mdi/js";
import { WindowVirtualizerController } from "@tanstack/lit-virtual";
import DOMPurify from "dompurify";
import { Effect, Exit, Option, Predicate } from "effect";
import { type Atom, AsyncResult, AtomRegistry } from "effect/reactivity";
import { css, html, LitElement, nothing, type TemplateResult } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { ref } from "lit/directives/ref.js";
import { repeat } from "lit/directives/repeat.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { marked } from "marked";
import { AtomController, registry } from "./AtomController.js";
import { parts, t } from "./i18n.js";
import { shared } from "./styles.js";
import "./triage-skeleton.js";
import {
  addNote,
  homeHref,
  issue,
  issueEvents,
  issueHref,
  setLabel,
  setStatus,
  tokenValues,
  unmergeIssue,
} from "./triage.js";
import {
  ago,
  badge,
  dragScroll,
  formatPercent,
  formatTime,
  icon,
  renderDefect,
  renderError,
  requestValues,
  severityLabel,
  shown,
  shownPlain,
  stateBadge,
  type TokenValues,
} from "./ui.js";

const resolve = [
  t("action.resolve"),
  "resolved",
  mdiCheckCircleOutline,
] as const;

const mute = [t("action.mute"), "muted", mdiBellOffOutline] as const;

const actions: Record<
  Issue.State,
  ReadonlyArray<readonly [label: string, status: Issue.Status, icon: string]>
> = {
  new: [resolve, mute],
  ongoing: [resolve, mute],
  quiet: [resolve, mute],
  regressed: [resolve, mute],
  resolved: [[t("action.reopen"), "open", mdiRestore]],
  muted: [[t("action.unmute"), "open", mdiBellOutline]],
};

const labels: ReadonlyArray<
  readonly [text: string, label: Api.Label, icon: string]
> = [
  [t("label.worth"), "worth", mdiThumbUpOutline],
  [t("label.noise"), "noise", mdiThumbDownOutline],
];

const kinds: Record<Issue.Kind, string> = {
  Crash: t("kind.Crash"),
  UnitFailure: t("kind.UnitFailure"),
  OutOfMemory: t("kind.OutOfMemory"),
  LogError: t("kind.LogError"),
};

/** The causes decision models pick from, as `Triager` asks for them. */
const causes = [
  "application",
  "configuration",
  "hardware",
  "user",
  "transient",
  "other",
] as const;

const isCause = (cause: string): cause is (typeof causes)[number] =>
  causes.some((known) => known === cause);

const causeTitle = (cause: string) =>
  isCause(cause) ? t(`cause.${cause}`) : cause;

/** The text for `count` events, such as "3 events". */
const eventCount = (count: number) => t("events", { count });

/** What to paste into an agent so it reads the issue through triage's MCP server. */
const agentMessage = (issue: Issue.Issue) =>
  `Triage issue ${issue.id}, ${issue.title}: ${location.href}\n\nRead it, its notes and all its events with the triage MCP server's get_issue and get_issue_events tools, and see how similar issues were fixed with find_similar_issues. Once it's fixed on every host it happened on, ask me whether to resolve it with set_issue_status, with a note on what fixed it.`;

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

      .fingerprints,
      .warnings,
      .nearby {
        list-style: none;
        margin: 0 0 var(--triage-space-8);
        padding: 0;
        display: grid;
        gap: var(--triage-space-2);
      }

      .fingerprints li,
      .warnings li,
      .nearby li {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--triage-space-2);
      }

      .fingerprints code,
      .warnings code {
        overflow-wrap: anywhere;
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

      .note-input {
        display: block;
        box-sizing: border-box;
        width: 100%;
        max-width: 48rem;
        min-height: 4.5rem;
        margin-bottom: var(--triage-space-2);
        padding: var(--triage-space-2) var(--triage-space-3);
        font: inherit;
        border: var(--triage-border-width) solid var(--triage-border);
        border-radius: var(--triage-border-radius-sm);
        background: var(--triage-surface);
        color: var(--triage-text);
        resize: vertical;
      }

      .notes {
        margin-bottom: var(--triage-space-8);
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

      .cards.events {
        display: block;
        position: relative;
      }

      .cards.events > li {
        position: absolute;
        inset: 0 0 auto;
      }

      .events-end {
        margin-top: var(--triage-space-3);
      }

      .cards > li.skeleton .event-message {
        line-height: normal;
      }

      .cards > li.skeleton .event-fields {
        overflow: hidden;
        mask-image: none;
      }

      .badge-skeleton {
        flex: none;
        height: 2rem;
        --triage-skeleton-radius: var(--triage-border-radius-pill);
      }

      .details-skeleton {
        height: 2.25rem;
        margin-top: var(--triage-space-3);
        --triage-skeleton-radius: var(--triage-border-radius-sm);
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
        max-width: 36rem;
        margin-bottom: var(--triage-space-8);
        padding: var(--triage-space-1-5) var(--triage-space-2);
        border: var(--triage-border-width) solid var(--triage-border);
        border-radius: var(--triage-border-radius-sm);
        background: var(--triage-bg);
        cursor: pointer;
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

  /** The note being written, saved with a status change or on its own. */
  @state() accessor note = "";

  readonly #detail = new AtomController(this, () => issue(this.issueId));

  readonly #setStatus = new AtomController(this, () => setStatus);

  readonly #addNote = new AtomController(this, () => addNote);

  readonly #setLabel = new AtomController(this, () => setLabel);

  readonly #unmerge = new AtomController(this, () => unmergeIssue);

  readonly #events = new AtomController(this, () => issueEvents(this.issueId));

  // Redraws once the values behind redaction tokens arrive.
  readonly #tokenValues = new AtomController(this, () => tokenValues);

  readonly #virtualizer = new WindowVirtualizerController<HTMLLIElement>(this, {
    count: 0,
    estimateSize: () => 160,
    overscan: 4,
  });

  /** The events list, whose position tells the virtualiser where it starts. */
  @query(".cards.events") accessor eventList: HTMLOListElement | null = null;

  override render() {
    return html`
      <a class="back" href=${homeHref}
        >${icon(mdiChevronLeft)}<span>${t("issue.back")}</span></a
      >
      ${AsyncResult.matchWithError(this.#detail.value, {
        onInitial: renderIssueSkeleton,
        onError: renderError,
        onDefect: renderDefect,
        onSuccess: ({ value }) => html`
          <h1>${shown(value.issue.title, this.#tokenValues.value)}</h1>
          <dl>
            <dt>${t("issue.state")}</dt>
            <dd>${stateBadge(value.issue.state)}</dd>
            <dt>${t("issue.kind")}</dt>
            <dd>${kinds[value.issue.kind]}</dd>
            <dt>${t("issue.eventCount")}</dt>
            <dd>${value.issue.count}</dd>
            <dt>${t("issue.firstSeen")}</dt>
            <dd title=${formatTime(value.issue.firstSeen)}>
              ${ago(value.issue.firstSeen)}
            </dd>
            <dt>${t("issue.lastSeen")}</dt>
            <dd title=${formatTime(value.issue.lastSeen)}>
              ${ago(value.issue.lastSeen)}
            </dd>
            <dt>${t("issue.hosts")}</dt>
            <dd>${renderHosts(value.hosts)}</dd>
          </dl>
          <textarea
            class="note-input"
            aria-label=${t("notes.input")}
            placeholder=${t("notes.placeholder")}
            maxlength=${Api.maxNote}
            .value=${this.note}
            @input=${(event: InputEvent) => {
              if (event.currentTarget instanceof HTMLTextAreaElement) {
                this.note = event.currentTarget.value;
              }
            }}
          ></textarea>
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
            <button
              ?disabled=${this.note.trim() === "" || this.#addNote.value.waiting}
              @click=${() => this.#saveNote(value.issue.id)}
            >
              ${icon(mdiNoteTextOutline)} ${t("notes.add")}
            </button>
          </div>
          <div
            class="agent"
            role="button"
            tabindex="0"
            @pointerdown=${(event: PointerEvent) => {
              this.#pointerDown = { x: event.clientX, y: event.clientY };
            }}
            @click=${(event: MouseEvent) => this.#copyForAgent(event)}
            @keydown=${(event: KeyboardEvent) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                void this.#copyForAgent(event);
              }
            }}
          >
            <span class="muted-text">
              ${icon(mdiContentCopy)}
              ${this.copied ? t("issue.copied") : t("issue.copyForAgent")}
            </span>
            <pre><code>${agentMessage(value.issue)}</code></pre>
          </div>
          ${
            value.fingerprints.length > 1
              ? this.#renderFingerprints(value)
              : nothing
          }
          <h2>${t("issue.notes")}</h2>
          ${renderNotes(value.notes)}
          <h2>${t("issue.decisions")}</h2>
          ${renderDecisions(value.decisions)}
          <div class="actions" role="group" aria-label=${t("issue.yourLabel")}>
            <span class="muted-text">${t("issue.yourLabel")}</span>
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
          <h2>${t("issue.suggestions")}</h2>
          ${renderSuggestions(value.suggestions)}
          ${
            value.warnings.length > 0
              ? renderWarnings(value.warnings, this.#tokenValues.value)
              : nothing
          }
          ${
            value.nearby.length > 0
              ? renderNearby(value.nearby, this.#tokenValues.value)
              : nothing
          }
          <h2>${t("issue.eventList")}</h2>
          ${this.#renderEvents()}
        `,
      })}
    `;
  }

  #renderFingerprints(review: Api.IssueReview) {
    return html`
      <h2>${t("issue.fingerprints")}</h2>
      <p class="muted-text">${t("fingerprints.hint")}</p>
      <ul class="fingerprints">
        ${review.fingerprints.map(
          ({ fingerprint, count }) => html`
            <li>
              <code>${fingerprint}</code>
              <span class="muted-text">${eventCount(count)}</span>
              <button
                ?disabled=${this.#unmerge.value.waiting}
                @click=${() => this.#splitOut(review.issue.id, fingerprint)}
              >
                ${icon(mdiCallSplit)} ${t("fingerprints.unmerge")}
              </button>
            </li>
          `,
        )}
      </ul>
    `;
  }

  #renderEvents() {
    return AsyncResult.matchWithError(this.#events.value, {
      onInitial: () => renderEventSkeletons(3),
      onError: (error) =>
        Predicate.isTagged(error, "NoSuchElementError")
          ? html`<p class="message">${t("issue.noEvents")}</p>`
          : this.#renderEventsFailure(renderError(error)),
      onDefect: () => this.#renderEventsFailure(renderDefect()),
      onSuccess: ({ value }) =>
        this.#renderEventList(
          value.items,
          value.done ? nothing : renderEventSkeletons(2),
        ),
    });
  }

  /** Keeps the events already loaded when a later page fails. */
  #renderEventsFailure(failure: TemplateResult) {
    const result = this.#events.value;

    if (!AsyncResult.isFailure(result)) {
      return failure;
    }

    return Option.match(result.previousSuccess, {
      onNone: () => failure,
      onSome: ({ value }) =>
        this.#renderEventList(
          value.items,
          html`<p class="message">
            ${t("issue.loadMoreFailed")}
            <button @click=${() => registry.refresh(issueEvents(this.issueId))}>
              ${icon(mdiRefresh)} ${t("retry")}
            </button>
          </p>`,
        ),
    });
  }

  #renderEventList(
    events: ReadonlyArray<Event.Event>,
    end: TemplateResult | typeof nothing,
  ) {
    const list = this.eventList;
    const virtualizer = this.#virtualizer.getVirtualizer();

    virtualizer.setOptions({
      ...virtualizer.options,
      count: events.length,
      getItemKey: (index) => events[index]?.id ?? index,
      gap: list === null ? 0 : Number.parseFloat(getComputedStyle(list).rowGap),
      scrollMargin:
        list === null ? 0 : list.getBoundingClientRect().top + window.scrollY,
    });

    return html`
      <ol class="cards events" style="height: ${virtualizer.getTotalSize()}px">
        ${repeat(
          virtualizer.getVirtualItems(),
          (item) => item.key,
          (item) => {
            const event = events[item.index];

            return event === undefined
              ? nothing
              : html`
                  <li
                    data-index=${item.index}
                    aria-setsize=${events.length}
                    aria-posinset=${item.index + 1}
                    style="transform: translateY(${
                      item.start - virtualizer.options.scrollMargin
                    }px)"
                    ${ref((element) => {
                      if (element instanceof HTMLLIElement) {
                        virtualizer.measureElement(element);
                      }
                    })}
                  >
                    ${renderEvent(event, this.#tokenValues.value)}
                  </li>
                `;
          },
        )}
      </ol>
      <div class="events-end">${end}</div>
    `;
  }

  override updated() {
    const detail = this.#detail.value;
    const loaded = AsyncResult.getOrElse(this.#events.value, () => undefined);
    const current = AsyncResult.getOrElse(detail, () => undefined);

    requestValues([
      current?.issue.title,
      ...(current?.nearby.map((other) => other.title) ?? []),
      ...(current?.warnings.map((warning) => warning.example) ?? []),
      ...(loaded?.items.flatMap((event) => [
        event.message,
        event.identifier,
        event.unit,
        ...(event.breadcrumbs ?? []),
      ]) ?? []),
    ]);

    // A merged issue's old link shows the issue it joined, under its own ID.
    if (
      AsyncResult.isSuccess(detail) &&
      detail.value.issue.id !== this.issueId
    ) {
      history.replaceState(
        null,
        "",
        new URL(issueHref(detail.value.issue.id), document.baseURI).href,
      );
    }

    const result = this.#events.value;

    if (!AsyncResult.isSuccess(result) || result.waiting || result.value.done) {
      return;
    }

    // Fetch the next page as the last loaded events scroll into view, once the
    // virtualiser knows where the list starts.
    const virtualizer = this.#virtualizer.getVirtualizer();
    const list = this.eventList;

    if (list === null) {
      return;
    }

    const top = list.getBoundingClientRect().top + window.scrollY;

    if (Math.abs(top - virtualizer.options.scrollMargin) >= 1) {
      this.requestUpdate();

      return;
    }

    const last = virtualizer.getVirtualItems().at(-1);

    if (last !== undefined && last.index >= virtualizer.options.count - 3) {
      registry.set(issueEvents(this.issueId), undefined);
    }
  }

  #copyTimer: ReturnType<typeof setTimeout> | undefined;

  #pointerDown: { readonly x: number; readonly y: number } | undefined;

  /**
   * Selects the message and copies it. The selection stays, so it can still
   * be copied by hand if the clipboard refuses. A drag only selects text.
   */
  async #copyForAgent(event: MouseEvent | KeyboardEvent) {
    const start = this.#pointerDown;

    this.#pointerDown = undefined;

    if (
      event instanceof MouseEvent &&
      start !== undefined &&
      Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4
    ) {
      return;
    }

    const code =
      event.currentTarget instanceof HTMLElement
        ? event.currentTarget.querySelector("code")
        : null;

    if (code === null) {
      return;
    }

    window.getSelection()?.selectAllChildren(code);

    // The clipboard API only exists in secure contexts, and Home Assistant is
    // often served over plain HTTP, where copying the selection still works.
    const copied = window.isSecureContext
      ? await navigator.clipboard.writeText(code.textContent).then(
          () => true,
          () => document.execCommand("copy"),
        )
      : document.execCommand("copy");

    if (!copied) {
      return;
    }

    this.copied = true;
    clearTimeout(this.#copyTimer);
    this.#copyTimer = setTimeout(() => {
      this.copied = false;
    }, 2000);
  }

  #changeStatus(id: string, status: Issue.Status) {
    const note = this.note.trim();

    registry.set(setStatus, {
      params: { id },
      payload: { status, ...(note !== "" && { note }) },
      reactivityKeys: ["issues"],
    });

    if (note !== "") {
      void this.#clearNoteAfter(setStatus, note);
    }
  }

  #saveNote(id: string) {
    const text = this.note.trim();

    registry.set(addNote, {
      params: { id },
      payload: { text },
      reactivityKeys: ["issues"],
    });

    void this.#clearNoteAfter(addNote, text);
  }

  /**
   * Clears the note once it's saved, unless it's been changed since. A note
   * that fails to save stays, to try again.
   */
  async #clearNoteAfter(
    mutation: Atom.Atom<AsyncResult.AsyncResult<unknown, unknown>>,
    sent: string,
  ) {
    const exit = await Effect.runPromiseExit(
      AtomRegistry.getResult(registry, mutation, { suspendOnWaiting: true }),
    );

    if (Exit.isSuccess(exit) && this.note.trim() === sent) {
      this.note = "";
    }
  }

  /** Unmerges a fingerprint, then reloads the events, which moved out with it. */
  async #splitOut(id: string, fingerprint: string) {
    registry.set(unmergeIssue, {
      params: { id },
      payload: { fingerprint },
      reactivityKeys: ["issues"],
    });

    const exit = await Effect.runPromiseExit(
      AtomRegistry.getResult(registry, unmergeIssue, {
        suspendOnWaiting: true,
      }),
    );

    if (Exit.isSuccess(exit)) {
      registry.refresh(issueEvents(this.issueId));
    }
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
  `${frame.function ?? "??"} (${frame.module ?? t("unknown")})`;

const renderDecisions = (decisions: ReadonlyArray<Api.IssueDecision>) =>
  decisions.length === 0
    ? html`<p class="muted-text">${t("decisions.none")}</p>`
    : html`
        <table>
          <thead>
            <tr>
              <th>${t("decisions.model")}</th>
              <th>${t("decisions.worth")}</th>
              <th>${t("decisions.severity")}</th>
              <th>${t("decisions.cause")}</th>
              <th>${t("decisions.by")}</th>
              <th>${t("decisions.decided")}</th>
            </tr>
          </thead>
          <tbody>
            ${decisions.map(
              (decision) => html`
                <tr>
                  <td>${decision.model}</td>
                  <td class="worth">${formatPercent(decision.worth)}</td>
                  <td>${severityLabel(decision.severity)}</td>
                  <td>${causeTitle(decision.cause)}</td>
                  <td>${decision.by ?? t("unknown")}</td>
                  <td title=${formatTime(decision.decidedAt)}>
                    ${t("issue.agoAt", {
                      ago: ago(decision.decidedAt),
                      events: eventCount(decision.issueCount),
                    })}
                  </td>
                </tr>
              `,
            )}
          </tbody>
        </table>
      `;

// The text comes from a language model or a note, so it's sanitised before
// rendering, without images so it can't make the browser fetch anything.
const markdown = (text: string) =>
  unsafeHTML(
    DOMPurify.sanitize(marked.parse(text, { async: false }), {
      FORBID_TAGS: ["img"],
      FORBID_ATTR: ["style"],
    }),
  );

const noteBadges: Record<
  Api.NoteStatus | "note",
  readonly [label: string, icon: string, kind: string]
> = {
  resolved: [
    t("notes.resolved"),
    mdiCheckCircleOutline,
    "small state resolved",
  ],
  muted: [t("notes.muted"), mdiBellOffOutline, "small state muted"],
  open: [t("notes.reopened"), mdiRestore, "small"],
  regressed: [
    t("notes.regressed"),
    mdiAlertDecagramOutline,
    "small state regressed",
  ],
  note: [t("notes.note"), mdiNoteTextOutline, "small"],
};

const renderNotes = (notes: ReadonlyArray<Api.IssueNote>) =>
  notes.length === 0
    ? html`<p class="muted-text notes">${t("notes.none")}</p>`
    : html`
        <ol class="cards notes">
          ${notes.map((note) => {
            const [content, path, kind] = noteBadges[note.status ?? "note"];

            return html`
              <li>
                <header>
                  ${badge({ path, content, kind })}
                  ${
                    note.by === null
                      ? nothing
                      : html`<span
                          >${
                            note.status === "regressed"
                              ? t("notes.from", { host: note.by })
                              : t("notes.by", { by: note.by })
                          }</span
                        >`
                  }
                  <time title=${formatTime(note.createdAt)}>
                    ${ago(note.createdAt)}
                  </time>
                </header>
                ${
                  note.text === ""
                    ? nothing
                    : html`<div class="suggestion">${markdown(note.text)}</div>`
                }
              </li>
            `;
          })}
        </ol>
      `;

const renderSuggestions = (suggestions: ReadonlyArray<Api.IssueSuggestion>) =>
  suggestions.length === 0
    ? html`<p class="muted-text">${t("suggestions.none")}</p>`
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
                      : html`<span
                          >${t("suggestions.by", { by: suggestion.by })}</span
                        >`
                  }
                  <time title=${formatTime(suggestion.suggestedAt)}>
                    ${ago(suggestion.suggestedAt)}
                  </time>
                  <span>
                    ${t("suggestions.at", {
                      events: eventCount(suggestion.issueCount),
                    })}
                  </span>
                </header>
                <div class="suggestion">${markdown(suggestion.text)}</div>
              </li>
            `,
          )}
        </ol>
      `;

const renderNearby = (
  nearby: ReadonlyArray<Api.NearbyIssue>,
  values: TokenValues,
) => html`
  <h2>${t("issue.nearby")}</h2>
  <p class="muted-text">${t("nearby.hint")}</p>
  <ul class="nearby">
    ${nearby.map(
      (other) => html`
        <li>
          ${stateBadge(other.state)}
          <a href=${issueHref(other.id)}>${shown(other.title, values)}</a>
          <span class="muted-text"
            >${t("nearby.near", { count: other.near })}</span
          >
        </li>
      `,
    )}
  </ul>
`;

const renderWarnings = (
  warnings: ReadonlyArray<Api.IssueWarning>,
  values: TokenValues,
) => html`
  <h2>${t("issue.warnings")}</h2>
  <p class="muted-text">${t("warnings.hint")}</p>
  <ul class="warnings">
    ${warnings.map(
      (warning) => html`
        <li>
          <code title=${shownPlain(warning.example, values)}
            >${warning.template}</code
          >
          <span class="muted-text">
            ${parts("warnings.seen", {
              count: warning.count,
              host: warning.host,
              last: html`<span title=${formatTime(warning.lastSeen)}
                >${ago(warning.lastSeen)}</span
              >`,
            })}
          </span>
        </li>
      `,
    )}
  </ul>
`;

const renderHosts = (hosts: ReadonlyArray<Api.HostCount>) => html`
  <ul class="hosts">
    ${hosts.map(
      (host) => html`
        <li>
          <strong>${host.host}</strong>
          <span class="muted-text">
            ${parts("issue.hostSeen", {
              events: eventCount(host.count),
              first: html`<span title=${formatTime(host.firstSeen)}
                >${ago(host.firstSeen)}</span
              >`,
              last: html`<span title=${formatTime(host.lastSeen)}
                >${ago(host.lastSeen)}</span
              >`,
            })}
          </span>
        </li>
      `,
    )}
  </ul>
`;

type Field = readonly [
  label: string,
  icon: string,
  value?: string | TemplateResult,
];

/**
 * A Home Assistant integration, with links to its docs and Core's issues for
 * a built-in one, or its version and issue tracker for a custom one.
 */
const renderIntegration = (integration: Event.Integration) => {
  if (integration.custom) {
    const name =
      integration.version === undefined
        ? integration.domain
        : `${integration.domain} ${integration.version}`;

    // Only web links, since the manifest is whatever its author wrote.
    const tracker =
      integration.issueTracker !== undefined &&
      /^https?:\/\//.test(integration.issueTracker)
        ? integration.issueTracker
        : undefined;

    return tracker === undefined
      ? html`${name} (${t("integration.custom")})`
      : html`${name} (${t("integration.custom")},
          <a href=${tracker} target="_blank" rel="noreferrer"
            >${t("integration.issues")}</a
          >)`;
  }

  const domain = encodeURIComponent(integration.domain);

  const issues = `https://github.com/home-assistant/core/issues?q=${encodeURIComponent(
    `is:issue label:"integration: ${integration.domain}"`,
  )}`;

  return html`${integration.domain} (<a
      href="https://www.home-assistant.io/integrations/${domain}/"
      target="_blank"
      rel="noreferrer"
      >${t("integration.docs")}</a
    >,
    <a href=${issues} target="_blank" rel="noreferrer"
      >${t("integration.issues")}</a
    >)`;
};

// Everything stored about where an event came from, in the order people look
// for it.
const eventFields = (event: Event.Event, values: TokenValues) => {
  const fields: ReadonlyArray<Field> = [
    [t("field.host"), mdiServer, event.host],
    [t("field.source"), mdiNotebookOutline, event.source],
    [
      t("field.program"),
      mdiApplicationOutline,
      event.identifier === undefined
        ? undefined
        : shown(event.identifier, values),
    ],
    [
      t("field.integration"),
      mdiPuzzleOutline,
      event.integration === undefined
        ? undefined
        : renderIntegration(event.integration),
    ],
    [
      t("field.unit"),
      mdiCogOutline,
      event.unit === undefined
        ? undefined
        : shown(
            event.scope === undefined
              ? event.unit
              : `${event.unit} (${event.scope})`,
            values,
          ),
    ],
    ...Event.Event.match<ReadonlyArray<Field>>(event, {
      Crash: (crash) => [
        [t("field.executable"), mdiFileCogOutline, crash.executable],
        [t("field.signal"), mdiLightningBolt, crash.signal],
      ],
      UnitFailure: (failure) => [
        [t("field.result"), mdiExitToApp, failure.result],
      ],
      OutOfMemory: (oom) => [[t("field.killed"), mdiSkullOutline, oom.process]],
      LogError: () => [],
    }),
    [
      t("field.package"),
      mdiPackageVariantClosed,
      event.package === undefined
        ? undefined
        : `${event.package.name} ${event.package.version}`,
    ],
    [t("field.os"), mdiLinux, event.system?.os],
    [t("field.kernel"), mdiChip, event.system?.kernel],
    [t("field.boot"), mdiPower, event.bootId],
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

/** Title widths for skeleton cards, so they don't look like a solid block. */
const skeletonTitleWidths = [72, 54, 86];

/** Badge widths for skeleton cards. */
const skeletonBadgeWidths = ["6rem", "5rem", "6rem", "9rem", "6rem", "8rem"];

const skeletonEvent = (index: number) => html`
  <li class="skeleton" aria-hidden="true">
    <div class="event-severity">
      <triage-skeleton-text
        style="--triage-skeleton-text-width: 4rem"
      ></triage-skeleton-text>
    </div>
    <div class="event-message">
      <triage-skeleton-text
        style="--triage-skeleton-text-width: ${
          skeletonTitleWidths[index % skeletonTitleWidths.length]
        }%"
      ></triage-skeleton-text>
    </div>
    <div class="event-time">
      <triage-skeleton-text
        style="--triage-skeleton-text-width: 6rem"
      ></triage-skeleton-text>
    </div>
    <div class="event-fields">
      ${skeletonBadgeWidths.map(
        (width) =>
          html`<triage-skeleton
            class="badge-skeleton"
            style="width: ${width}"
          ></triage-skeleton>`,
      )}
    </div>
    <triage-skeleton class="details-skeleton"></triage-skeleton>
  </li>
`;

/** Placeholder event cards, for while events load. */
const renderEventSkeletons = (count: number) => html`
  <ol class="cards" aria-busy="true" aria-label=${t("issue.loadingEvents")}>
    ${Array.from({ length: count }, (_, index) => skeletonEvent(index))}
  </ol>
`;

/** Placeholder for the top of the page, for while the issue loads. */
const renderIssueSkeleton = () => html`
  <div aria-busy="true" aria-label=${t("issue.loading")}>
    <h1>
      <triage-skeleton-text
        style="--triage-skeleton-text-width: 60%"
      ></triage-skeleton-text>
    </h1>
    <dl aria-hidden="true">
      ${(
        [
          "issue.state",
          "issue.kind",
          "issue.eventCount",
          "issue.firstSeen",
          "issue.lastSeen",
          "issue.hosts",
        ] as const
      ).map(
        (label) => html`
          <dt>${t(label)}</dt>
          <dd>
            <triage-skeleton-text
              style="--triage-skeleton-text-width: 6rem"
            ></triage-skeleton-text>
          </dd>
        `,
      )}
    </dl>
  </div>
  <h2>${t("issue.eventList")}</h2>
  ${renderEventSkeletons(3)}
`;

const renderEvent = (event: Event.Event, values: TokenValues) => html`
  <div class="event-severity severity ${event.severity}">
    ${icon(severityIcons[event.severity])} ${t(`level.${event.severity}`)}
  </div>
  <pre class="event-message">${shown(event.message, values)}</pre>
  <time class="event-time" title=${formatTime(event.timestamp)}
    >${icon(mdiClockOutline)} ${ago(event.timestamp)}</time
  >
  <div class="event-fields" @pointerdown=${dragScroll}>
    ${eventFields(event, values).map(([label, path, value]) =>
      badge({ path, label, content: value, kind: "dense" }),
    )}
  </div>
  ${
    Predicate.isTagged(event, "Crash") && event.frames.length > 0
      ? html`<details>
          <summary
            title=${t("issue.stackTrace")}
            aria-label=${t("issue.stackTrace")}
          >
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
            title=${t("issue.breadcrumbs")}
            aria-label=${t("issue.breadcrumbs")}
          >
            ${icon(mdiChevronRight)} ${icon(mdiHistory)}
            <code class="preview"
              >${shown(event.breadcrumbs.at(-1) ?? "", values)}</code
            >
          </summary>
          <pre><code>${shown(event.breadcrumbs.join("\n"), values)}</code></pre>
        </details>`
  }
`;

declare global {
  interface HTMLElementTagNameMap {
    "triage-issue": TriageIssue;
  }
}
