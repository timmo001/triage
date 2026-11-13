import { mdiLogout, mdiMenu } from "@mdi/js";
import { Schema } from "effect";
import { css, html, LitElement, nothing } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { AtomController, registry } from "./AtomController.js";
import { t } from "./i18n.js";
import { shared } from "./styles.js";
import { homeHref, Route, route, token } from "./triage.js";
import { bindThemePicker } from "./theme/picker.js";
import { icon } from "./ui.js";
import "@timmo001/groundwork-ui/define/gw-theme-picker.ts";
import type { GwThemePicker } from "@timmo001/groundwork-ui/gw-theme-picker.ts";
import "./triage-issue.js";
import "./triage-issues.js";
import "./triage-sign-in.js";

/**
 * Set by the server under Home Assistant ingress: `true` when the app's
 * `hide_sidebar` option is on, `false` when it's off.
 */
const hideSidebar = document.documentElement.dataset["hideSidebar"];

/** What Home Assistant sends a page that subscribes to its properties. */
const isHomeAssistantProperties = Schema.is(
  Schema.Struct({
    type: Schema.Literal("home-assistant/properties"),
    narrow: Schema.Boolean,
  }),
);

const postToHomeAssistant = (message: {
  readonly type: string;
  readonly kioskMode?: boolean;
}) => window.parent.postMessage(message, "*");

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

      header .sidebar {
        border-color: transparent;
        background: none;
      }

      header gw-theme-picker {
        margin-left: auto;
      }

      main {
        max-width: 120rem;
        margin: 0 auto;
        padding: 1rem var(--triage-gutter) 3rem;
      }
    `,
  ];

  readonly #token = new AtomController(this, () => token);

  readonly #route = new AtomController(this, () => route);

  /**
   * Whether Home Assistant's sidebar is hidden around the page, so the header
   * offers a button to show it.
   */
  @state() accessor sidebarHidden = false;

  override render() {
    return html`
      <header>
        ${
          this.sidebarHidden
            ? html`<button
                class="sidebar icon-only"
                aria-label=${t("homeAssistantSidebar")}
                title=${t("homeAssistantSidebar")}
                @click=${() =>
                  postToHomeAssistant({ type: "home-assistant/toggle-menu" })}
              >
                ${icon(mdiMenu)}
              </button>`
            : nothing
        }
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
        <gw-theme-picker gallery label=${t("theme")}></gw-theme-picker>
        ${
          this.#token.value === ""
            ? null
            : html`<button @click=${this.#signOut}>
                ${icon(mdiLogout)} ${t("signOut")}
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

  @query("gw-theme-picker") accessor picker: GwThemePicker | null = null;

  #unbindTheme: (() => void) | undefined;

  /** Whether the page last asked Home Assistant for kiosk mode, once it has. */
  #kioskMode: boolean | undefined;

  /**
   * Home Assistant's kiosk mode hides its sidebar and header around the page,
   * and its sidebar then opens over the page as it does on a phone. On a phone
   * the page leaves kiosk mode, so Home Assistant's own header and menu stay.
   * Home Assistant only turns kiosk mode on when the page subscribes, and off
   * when it unsubscribes, so changing it takes both.
   */
  readonly #onHomeAssistantMessage = (event: MessageEvent) => {
    if (
      event.source !== window.parent ||
      !isHomeAssistantProperties(event.data)
    ) {
      return;
    }

    const kioskMode = !event.data.narrow;

    if (kioskMode === this.#kioskMode) {
      return;
    }

    this.#kioskMode = kioskMode;
    this.sidebarHidden = kioskMode;

    if (!kioskMode) {
      postToHomeAssistant({ type: "home-assistant/unsubscribe-properties" });
    }

    postToHomeAssistant({
      type: "home-assistant/subscribe-properties",
      kioskMode,
    });
  };

  override connectedCallback() {
    super.connectedCallback();

    if (window.parent === window) {
      return;
    }

    // Home Assistant keeps kiosk mode across a reload of the page, so with
    // the option off the page leaves it. The button only shows once Home
    // Assistant answers, so an older one that ignores kiosk mode keeps its
    // own header and doesn't get two.
    if (hideSidebar === "false") {
      postToHomeAssistant({ type: "home-assistant/unsubscribe-properties" });
    } else if (hideSidebar === "true") {
      window.addEventListener("message", this.#onHomeAssistantMessage);
      postToHomeAssistant({ type: "home-assistant/subscribe-properties" });
    }
  }

  override firstUpdated() {
    if (this.picker !== null) {
      this.#unbindTheme = bindThemePicker(this.picker);
    }
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.#unbindTheme?.();
    window.removeEventListener("message", this.#onHomeAssistantMessage);
  }

  readonly #signOut = () => registry.set(token, "");
}

declare global {
  interface HTMLElementTagNameMap {
    "triage-app": TriageApp;
  }
}
