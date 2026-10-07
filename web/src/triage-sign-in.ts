import { css, html, LitElement } from "lit";
import { customElement } from "lit/decorators.js";
import { registry } from "./AtomController.js";
import { parts, t } from "./i18n.js";
import { shared } from "./styles.js";
import { token } from "./triage.js";

@customElement("triage-sign-in")
export class TriageSignIn extends LitElement {
  static override styles = [
    shared,
    css`
      form {
        display: grid;
        gap: 0.75rem;
        max-width: 28rem;
        margin: 3rem auto;
      }

      input {
        font: inherit;
        padding: 0.5rem 0.75rem;
        border: 1px solid var(--triage-border);
        border-radius: 0.4rem;
        background: var(--triage-surface);
        color: var(--triage-text);
      }

      button {
        justify-self: start;
      }
    `,
  ];

  override render() {
    return html`
      <form @submit=${this.#submit}>
        <h1>${t("signIn.title")}</h1>
        <label for="token">${t("signIn.token")}</label>
        <input
          id="token"
          name="token"
          type="password"
          autocomplete="current-password"
          required
        />
        <p class="muted-text">
          ${parts("signIn.hint", {
            command: html`<code>triage admins add &lt;name&gt;</code>`,
          })}
        </p>
        <button type="submit">${t("signIn.submit")}</button>
      </form>
    `;
  }

  readonly #submit = (event: SubmitEvent) => {
    event.preventDefault();

    if (!(event.currentTarget instanceof HTMLFormElement)) {
      return;
    }

    const input = event.currentTarget.elements.namedItem("token");

    if (input instanceof HTMLInputElement && input.value.trim() !== "") {
      registry.set(token, input.value.trim());
    }
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "triage-sign-in": TriageSignIn;
  }
}
