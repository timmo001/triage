import { css } from "lit";

export const shared = css`
  :host {
    display: block;
    /* Placeholders in Triage's border color, with its small corners */
    --gw-skeleton-color: var(--triage-border);
    --gw-skeleton-radius: 0.25rem;
  }

  h1 {
    font-size: var(--triage-font-size-3xl);
    font-weight: var(--triage-font-weight-bold);
    line-height: var(--triage-line-height-condensed);
  }

  h2 {
    font-size: var(--triage-font-size-2xl);
    font-weight: var(--triage-font-weight-bold);
    line-height: var(--triage-line-height-condensed);
  }

  pre,
  code {
    font-family: var(--triage-font-family-code);
  }

  a {
    color: var(--triage-accent);
  }

  .icon {
    flex: none;
    width: 1.15em;
    height: 1.15em;
    fill: currentColor;
  }

  button {
    display: inline-flex;
    align-items: center;
    gap: var(--triage-space-1-5);
    font: inherit;
    padding: var(--triage-space-1-5) var(--triage-space-3);
    border: var(--triage-border-width) solid var(--triage-border);
    border-radius: var(--triage-border-radius-sm);
    background: var(--triage-surface);
    color: var(--triage-text);
    cursor: pointer;
  }

  button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  button.icon-only {
    padding: var(--triage-space-1-5);
  }

  button[aria-pressed="true"] {
    border-color: var(--triage-accent);
    color: var(--triage-accent);
  }

  /*
   * Triage's own badge sizes, kept whatever the theme's density: 28px with
   * 14px text for states and notes, and 32px for event fields
   */
  .badge.small {
    --gw-badge-scale: calc(0.78 / var(--gw-control-scale, 1));
  }

  .badge.small::part(value) {
    font-size: var(--triage-font-size-s);
    font-weight: var(--triage-font-weight-medium);
  }

  .badge.dense {
    --gw-badge-scale: calc(0.89 / var(--gw-control-scale, 1));
  }

  /* Each state's own color, which none of the kit's tones fits */
  .state.new {
    --gw-tone: var(--triage-new);
  }

  .state.regressed {
    --gw-tone: var(--triage-regressed);
  }

  .state.ongoing {
    --gw-tone: var(--triage-ongoing);
  }

  .state.quiet {
    --gw-tone: var(--triage-quiet);
  }

  .state.resolved {
    --gw-tone: var(--triage-resolved);
  }

  .state.muted {
    --gw-tone: var(--triage-muted-state);
  }

  .muted-text {
    color: var(--triage-muted);
  }

  /* An error or notice in the flow of a page, a gw-alert */
  .message {
    margin: var(--triage-space-4) 0;
  }

  /* A redacted value shown from this machine, with its token in the tooltip. */
  .resolved {
    text-decoration: underline dotted var(--triage-muted);
    text-underline-offset: 0.2em;
    cursor: help;
  }
`;
