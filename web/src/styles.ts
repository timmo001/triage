import { css } from "lit";

export const shared = css`
  :host {
    display: block;
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

  .badge {
    --badge-color: var(--triage-accent);
    display: inline-flex;
    align-items: center;
    gap: var(--triage-space-2);
    max-width: 100%;
    min-height: 2.25rem;
    box-sizing: border-box;
    padding: var(--triage-space-1) var(--triage-space-4) var(--triage-space-1)
      var(--triage-space-3);
    border: var(--triage-border-width) solid var(--triage-border);
    border-radius: var(--triage-border-radius-pill);
    background: var(--triage-surface);
    color: var(--triage-text);
    vertical-align: middle;
  }

  .badge > .icon {
    color: var(--badge-color);
  }

  .badge-info {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .badge-label {
    font-size: var(--triage-font-size-xs);
    font-weight: var(--triage-font-weight-medium);
    line-height: var(--triage-line-height-condensed);
    color: var(--triage-muted);
  }

  .badge-content {
    font-size: var(--triage-font-size-s);
    font-weight: var(--triage-font-weight-medium);
    line-height: var(--triage-line-height-condensed);
    overflow-wrap: anywhere;
  }

  .badge.small {
    gap: var(--triage-space-1);
    min-height: 1.75rem;
    padding: var(--triage-space-0-5) var(--triage-space-2)
      var(--triage-space-0-5) var(--triage-space-1-5);
  }

  .badge.small .badge-content {
    white-space: nowrap;
  }

  .badge.dense {
    gap: var(--triage-space-1-5);
    min-height: 2rem;
    padding: var(--triage-space-0-5) var(--triage-space-3)
      var(--triage-space-0-5) var(--triage-space-2);
  }

  .badge.dense > .icon {
    width: 1em;
    height: 1em;
  }

  .badge.dense .badge-label {
    font-size: var(--triage-font-size-2xs);
  }

  .badge.dense .badge-content {
    font-size: var(--triage-font-size-xs);
  }

  .state.new {
    --badge-color: var(--triage-new);
  }

  .state.regressed {
    --badge-color: var(--triage-regressed);
  }

  .state.ongoing {
    --badge-color: var(--triage-ongoing);
  }

  .state.quiet {
    --badge-color: var(--triage-quiet);
  }

  .state.resolved {
    --badge-color: var(--triage-resolved);
  }

  .state.muted {
    --badge-color: var(--triage-muted-state);
  }

  .muted-text {
    color: var(--triage-muted);
  }

  .message {
    padding: var(--triage-space-8) 0;
    color: var(--triage-muted);
  }

  /* A redacted value shown from this machine, with its token in the tooltip. */
  .resolved {
    text-decoration: underline dotted var(--triage-muted);
    text-underline-offset: 0.2em;
    cursor: help;
  }
`;
