import { mdiLogout } from "@mdi/js";
import { css, html, LitElement } from "lit";
import { customElement } from "lit/decorators.js";
import { AtomController, registry } from "./AtomController.js";
import { homeHref, Route, route, token } from "./triage.js";
import { icon, shared } from "./ui.js";
import "./triage-issue.js";
import "./triage-issues.js";
import "./triage-sign-in.js";

@customElement("triage-app")
export class TriageApp extends LitElement {
  static override styles = [
    shared,
    css`
      :host {
        --triage-gutter: 1.5rem;
      }

      @media (max-width: 39.99rem) {
        :host {
          --triage-gutter: 1rem;
        }
      }

      header {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.75rem var(--triage-gutter);
        border-bottom: 1px solid var(--triage-border);
        background: var(--triage-surface);
      }

      header a {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        color: inherit;
        font-weight: 600;
        text-decoration: none;
      }

      header svg {
        width: 1.75rem;
        height: 1.75rem;
      }

      header button {
        margin-left: auto;
      }

      main {
        max-width: 72rem;
        margin: 0 auto;
        padding: 1rem var(--triage-gutter) 3rem;
      }
    `,
  ];

  readonly #token = new AtomController(this, () => token);

  readonly #route = new AtomController(this, () => route);

  override render() {
    return html`
      <header>
        <a href=${homeHref}>
          <svg viewBox="0 0 128 128" aria-hidden="true">
            <path
              fill="#3F3F46"
              fill-rule="evenodd"
              d="M40 8H88L106 26V108A12 12 0 0 1 94 120H34A12 12 0 0 1 22 108V26ZM64 17a7 7 0 1 0 0 14a7 7 0 1 0 0-14Z"
            />
            <rect x="22" y="76" width="84" height="15" fill="#EF4444" />
            <rect x="22" y="91" width="84" height="14" fill="#F59E0B" />
            <rect x="22" y="105" width="84" height="15" fill="#22C55E" />
            <path
              fill="none"
              stroke="#FFFFFF"
              stroke-width="7"
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M38 43 50 53 38 63"
            />
            <rect x="56" y="58" width="26" height="7" rx="3.5" fill="#FFFFFF" />
          </svg>
          Triage
        </a>
        ${
          this.#token.value === ""
            ? null
            : html`<button @click=${this.#signOut}>
                ${icon(mdiLogout)} Sign out
              </button>`
        }
      </header>
      <main>
        ${Route.$match(this.#route.value, {
          Issues: () => html`<triage-issues></triage-issues>`,
          Issue: ({ id }) => html`<triage-issue .issueId=${id}></triage-issue>`,
        })}
      </main>
    `;
  }

  readonly #signOut = () => registry.set(token, "");
}

declare global {
  interface HTMLElementTagNameMap {
    "triage-app": TriageApp;
  }
}
