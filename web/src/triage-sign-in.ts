import { css, html, LitElement } from "lit";
import { customElement } from "lit/decorators.js";
import { registry } from "./AtomController.js";
import { parts, t } from "./i18n.js";
import { shared } from "./styles.js";
import { token } from "./triage.js";
import "@timmo001/groundwork-ui/gw-button.ts";
import "@timmo001/groundwork-ui/gw-input.ts";

@customElement("triage-sign-in")
export class TriageSignIn extends LitElement {
  static override styles = [
    shared,
    css`
      form {
        display: grid;
        gap: var(--gw-space-3);
        max-width: 28rem;
        margin: 3rem auto;
      }

      p {
        margin: 0;
      }

      gw-button {
        justify-self: start;
      }
    `,
  ];

  override render() {
    return html`
      <form @submit=${this.#submit}>
        <h1>${t("signIn.title")}</h1>
        <gw-input
          label=${t("signIn.token")}
          name="token"
          type="password"
          autocomplete="current-password"
          required
        ></gw-input>
        <p class="muted-text">
          ${parts("signIn.hint", {
            command: html`<code>triage admins add &lt;name&gt;</code>`,
          })}
        </p>
        <gw-button type="submit">${t("signIn.submit")}</gw-button>
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
