import { Api, type Issue } from "@timmo001/effect-triage";
import {
  mdiAlertDecagramOutline,
  mdiBellOffOutline,
  mdiCheckCircleOutline,
  mdiLogout,
  mdiProgressClock,
  mdiSleep,
  mdiStarFourPointsOutline,
} from "@mdi/js";
import { Predicate } from "effect";
import { html, nothing, svg } from "lit";
import { registry } from "./AtomController.js";
import { language, t } from "./i18n.js";
import "./triage-sign-in.js";
import { resolveTokens, token } from "./triage.js";

/** A Material Design icon, from one of `@mdi/js`'s paths. */
export const icon = (path: string) =>
  html`<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
    ${svg`<path d=${path}></path>`}
  </svg>`;

const dragThreshold = 4;

/**
 * A `pointerdown` handler that lets a mouse drag a horizontal scroller, as
 * touch and trackpads already can, after Home Assistant's
 * DragScrollController. The row gets a `dragging` class while it moves.
 */
export const dragScroll = (event: PointerEvent) => {
  const scroller = event.currentTarget;

  if (
    event.pointerType !== "mouse" ||
    event.button !== 0 ||
    !(scroller instanceof HTMLElement)
  ) {
    return;
  }

  const startX = event.clientX;
  const startLeft = scroller.scrollLeft;
  const done = new AbortController();
  const { signal } = done;

  scroller.addEventListener(
    "pointermove",
    (move) => {
      const distance = move.clientX - startX;

      if (!scroller.hasPointerCapture(move.pointerId)) {
        if (Math.abs(distance) < dragThreshold) {
          return;
        }

        scroller.setPointerCapture(move.pointerId);
        scroller.classList.add("dragging");
        getSelection()?.removeAllRanges();
      }

      scroller.scrollLeft = startLeft - distance;
    },
    { signal },
  );

  for (const type of ["pointerup", "pointercancel"]) {
    window.addEventListener(
      type,
      () => {
        scroller.classList.remove("dragging");
        done.abort();
      },
      { signal },
    );
  }
};

/**
 * A pill with an icon and a value, with an optional small label above the
 * value, after Home Assistant's badges. `kind` adds classes that set
 * `--badge-color`, or the `small` and `dense` size variants.
 */
export const badge = ({
  path,
  content,
  label,
  kind = "",
}: {
  readonly path: string;
  readonly content: unknown;
  readonly label?: string;
  readonly kind?: string;
}) =>
  html`<span class="badge ${kind}">
    ${icon(path)}
    <span class="badge-info">
      ${
        label === undefined
          ? nothing
          : html`<span class="badge-label">${label}</span>`
      }
      <span class="badge-content">${content}</span>
    </span>
  </span>`;

const stateIcons: Record<Issue.State, string> = {
  regressed: mdiAlertDecagramOutline,
  new: mdiStarFourPointsOutline,
  ongoing: mdiProgressClock,
  quiet: mdiSleep,
  resolved: mdiCheckCircleOutline,
  muted: mdiBellOffOutline,
};

export const stateBadge = (state: Issue.State) =>
  badge({
    path: stateIcons[state],
    content: t(`state.${state}`),
    kind: `small state ${state}`,
  });

const percentage = new Intl.NumberFormat(language(), {
  style: "percent",
  maximumFractionDigits: 0,
});

/** A probability as a percentage, such as "82%". */
export const formatPercent = (probability: number) =>
  percentage.format(probability);

const severities = ["none", "minor", "major", "critical"] as const;

/** The nearest severity level to a 0 to 3 rating. */
export const severityLabel = (severity: number) =>
  t(
    `severity.${severities[Math.min(3, Math.max(0, Math.round(severity)))] ?? "none"}`,
  );

const relative = new Intl.RelativeTimeFormat(language(), { numeric: "auto" });

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

const dateTime = new Intl.DateTimeFormat(language(), {
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
          ${t("error.tokenRefused")}
          <button @click=${signOut}>${icon(mdiLogout)} ${t("signOut")}</button>
        </p>`;
  }

  if (Predicate.isTagged(error, "IssueNotFound")) {
    return html`<p class="message">${t("error.issueNotFound")}</p>`;
  }

  return html`<p class="message">${t("error.generic")}</p>`;
};

export const renderDefect = () =>
  html`<p class="message">${t("error.unreachable")}</p>`;

export const renderLoading = () =>
  html`<p class="message" aria-busy="true">${t("loading")}</p>`;

/** A redaction token, such as `<ip:71d0a3c2e94b>`, kept by the split below. */
const tokenPattern = /(<[a-z]+:[0-9a-f]{12}>)/;

/** The redaction tokens in some texts, for asking the server for their values. */
export const tokensIn = (
  texts: ReadonlyArray<string | undefined>,
): ReadonlyArray<string> =>
  texts.flatMap((text) =>
    text === undefined
      ? []
      : text.split(tokenPattern).filter((_, index) => index % 2 === 1),
  );

/** Tokens already asked about, so each one is only asked for once. */
const askedTokens = new Set<string>();

/**
 * Ask the server for the values behind the tokens in some texts, once each.
 * Safe to call on every render, since it only asks about new ones.
 */
export const requestValues = (texts: ReadonlyArray<string | undefined>) => {
  const wanted = [...new Set(tokensIn(texts))]
    .filter((found) => !askedTokens.has(found))
    .slice(0, Api.maxTokens);

  if (wanted.length === 0) {
    return;
  }

  for (const found of wanted) {
    askedTokens.add(found);
  }

  registry.set(resolveTokens, wanted);
};

/**
 * Text with each redaction token the server has shown the value of replaced
 * by it, marked so it reads as a value only this machine knows, with the
 * token in its tooltip. Tokens without a known value stay as they are.
 */
export const shown = (text: string, values: TokenValues) =>
  html`${text.split(tokenPattern).map((part, index) => {
    const value = index % 2 === 1 ? values.get(part) : undefined;

    return value === undefined
      ? part
      : html`<span class="resolved" title=${part}>${value.value}</span>`;
  })}`;

/** Like `shown`, as plain text for attributes such as tooltips. */
export const shownPlain = (text: string, values: TokenValues) =>
  text
    .split(tokenPattern)
    .map((part, index) =>
      index % 2 === 1 ? (values.get(part)?.value ?? part) : part,
    )
    .join("");

/** The values behind redaction tokens the server has shown, by token. */
export type TokenValues = ReadonlyMap<string, Api.Redaction>;
