import { css, type CSSResultGroup, LitElement } from "lit";
import { customElement } from "lit/decorators.js";

/**
 * Placeholder shown while content loads. Sized by its container unless a
 * more specific variant such as `triage-skeleton-text` is used.
 *
 * @cssprop --triage-skeleton-color - The fill colour. Defaults to the border colour.
 * @cssprop --triage-skeleton-radius - The corner radius. Defaults to `0.25rem`.
 */
@customElement("triage-skeleton")
export class TriageSkeleton extends LitElement {
  static override styles: CSSResultGroup = css`
    :host {
      display: block;
      min-height: 1rem;
      border-radius: var(--triage-skeleton-radius, 0.25rem);
      background: var(--triage-skeleton-color, var(--triage-border));
      animation: pulse 2s ease-in-out infinite;
    }

    @keyframes pulse {
      50% {
        opacity: 0.4;
      }
    }

    @media (forced-colors: active) {
      :host {
        background: GrayText;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      :host {
        animation: none;
      }
    }
  `;
}

/**
 * Placeholder for a line of text. Its height follows the surrounding font
 * size. Set the width to fit the expected text.
 *
 * @cssprop --triage-skeleton-text-width - The width of the placeholder. Defaults to `8rem`.
 */
@customElement("triage-skeleton-text")
export class TriageSkeletonText extends TriageSkeleton {
  static override styles = [
    TriageSkeleton.styles,
    css`
      :host {
        display: inline-block;
        vertical-align: middle;
        width: var(--triage-skeleton-text-width, 8rem);
        max-width: 100%;
        height: 1em;
        min-height: 0;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "triage-skeleton": TriageSkeleton;
    "triage-skeleton-text": TriageSkeletonText;
  }
}
