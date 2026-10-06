import type { Issue } from "@timmo001/effect-triage";
import { Predicate } from "effect";
import { css, html } from "lit";
import { registry } from "./AtomController.js";
import { token } from "./triage.js";

export const shared = css`
  :host {
    display: block;
  }

  a {
    color: var(--triage-accent);
  }

  button {
    font: inherit;
    padding: 0.35rem 0.8rem;
    border: 1px solid var(--triage-border);
    border-radius: 0.4rem;
    background: var(--triage-surface);
    color: var(--triage-text);
    cursor: pointer;
  }

  button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  button[aria-pressed="true"] {
    border-color: var(--triage-accent);
    color: var(--triage-accent);
  }

  .state {
    display: inline-block;
    min-width: 5.5rem;
    font-size: 0.8rem;
    font-weight: 600;
    text-transform: capitalize;
  }

  .state.new {
    color: var(--triage-new);
  }

  .state.regressed {
    color: var(--triage-regressed);
  }

  .state.ongoing {
    color: var(--triage-ongoing);
  }

  .state.resolved {
    color: var(--triage-resolved);
  }

  .state.muted {
    color: var(--triage-muted-state);
  }

  .muted-text {
    color: var(--triage-muted);
  }

  .message {
    padding: 2rem 0;
    color: var(--triage-muted);
  }
`;

export const stateBadge = (state: Issue.State) =>
  html`<span class="state ${state}">${state}</span>`;

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

const units: ReadonlyArray<readonly [Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 60 * 60 * 1000],
  ["month", 30 * 24 * 60 * 60 * 1000],
  ["week", 7 * 24 * 60 * 60 * 1000],
  ["day", 24 * 60 * 60 * 1000],
  ["hour", 60 * 60 * 1000],
  ["minute", 60 * 1000],
];

/** How long ago a time was, such as "3 hours ago". */
export const ago = (millis: number) => {
  const elapsed = millis - Date.now();
  const unit = units.find(([, size]) => Math.abs(elapsed) >= size);

  return unit === undefined
    ? relative.format(0, "minute")
    : relative.format(Math.round(elapsed / unit[1]), unit[0]);
};

const dateTime = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "medium",
});

export const formatTime = (millis: number) => dateTime.format(millis);

const signOut = () => registry.set(token, "");

/**
 * A request's error. A refusal asks for an admin token, unless one was
 * already given, when it offers to sign out instead. Behind Home Assistant
 * ingress the server never refuses, so no token is needed.
 */
export const renderError = (error: { readonly _tag: string }) => {
  if (Predicate.isTagged(error, "Unauthorized")) {
    return registry.get(token) === ""
      ? html`<triage-sign-in></triage-sign-in>`
      : html`<p class="message">
          The server didn't accept this admin token.
          <button @click=${signOut}>Sign out</button>
        </p>`;
  }

  if (Predicate.isTagged(error, "IssueNotFound")) {
    return html`<p class="message">There's no such issue.</p>`;
  }

  return html`<p class="message">Something went wrong.</p>`;
};

export const renderDefect = () =>
  html`<p class="message">Couldn't reach the triage server.</p>`;

export const renderLoading = () =>
  html`<p class="message" aria-busy="true">Loading…</p>`;
