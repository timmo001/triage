/**
 * The Backups page: makes a backup of the server's store while it runs, lists
 * the ones kept beside it to download, restore or delete, and restores a file
 * from this device. The server restarts once it's checked a backup, and the
 * page loads again when it's back.
 */
import type { Api } from "@timmo001/effect-triage";
import {
  mdiArchiveArrowDownOutline,
  mdiChevronLeft,
  mdiDeleteOutline,
  mdiDownload,
  mdiRestore,
  mdiUpload,
} from "@mdi/js";
import { Cause, Effect, Exit, Option, Predicate } from "effect";
import { type Atom, AsyncResult, AtomRegistry } from "effect/reactivity";
import { css, html, LitElement, nothing } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { AtomController, registry } from "./AtomController.js";
import { t } from "./i18n.js";
import { shared } from "./styles.js";
import {
  backupLink,
  backups,
  createBackup,
  homeHref,
  reloadWhenBack,
  removeBackup,
  restoreBackup,
  uploadBackup,
} from "./triage.js";
import {
  formatTime,
  icon,
  renderDefect,
  renderEmpty,
  renderError,
} from "./ui.js";
import "@timmo001/groundwork-ui/define/gw-alert.ts";
import "@timmo001/groundwork-ui/define/gw-button.ts";
import "@timmo001/groundwork-ui/define/gw-dialog.ts";
import type { GwDialog } from "@timmo001/groundwork-ui/gw-dialog.ts";

/** A backup to restore: one kept on the server, by name, or a file from here. */
type Chosen = { readonly name: string } | { readonly file: File };

/** A size in words, such as `12 KB` or `3.4 MB`. */
const sizeText = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.ceil(bytes / 1024))} KB`
    : bytes < 1024 ** 3
      ? `${(bytes / 1024 ** 2).toFixed(1)} MB`
      : `${(bytes / 1024 ** 3).toFixed(2)} GB`;

/** What went wrong, from the server's own message where it gave one. */
const failure = (cause: Cause.Cause<unknown>) =>
  Option.match(Cause.findErrorOption(cause), {
    onNone: () => t("error.unreachable"),
    onSome: (error) =>
      Predicate.hasProperty(error, "message") &&
      Predicate.isString(error.message)
        ? error.message
        : t("error.generic"),
  });

/** Runs a mutation atom, and waits for its result. */
const run = <A, E>(
  mutation: Atom.Writable<AsyncResult.AsyncResult<A, E>, never>,
) =>
  Effect.runPromiseExit(
    AtomRegistry.getResult(registry, mutation, { suspendOnWaiting: true }),
  );

@customElement("triage-backups")
export class TriageBackups extends LitElement {
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

      section {
        margin-bottom: var(--triage-space-8);
      }

      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--triage-space-2);
      }

      table {
        width: 100%;
        border-collapse: collapse;
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

      td.name {
        font-family: var(--triage-font-family-code);
        overflow-wrap: anywhere;
      }

      td.size {
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }

      td.row-actions {
        width: 1%;
        white-space: nowrap;
      }

      @media (max-width: 39.99rem) {
        .name {
          display: none;
        }
      }
    `,
  ];

  readonly #backups = new AtomController(this, () => backups);

  readonly #create = new AtomController(this, () => createBackup);

  readonly #remove = new AtomController(this, () => removeBackup);

  readonly #link = new AtomController(this, () => backupLink);

  /** What the last action said, and how it went. */
  @state() accessor notice:
    { readonly text: string; readonly tone: "danger" | "success" } | undefined =
    undefined;

  /** The backup the restore dialog asks about. */
  @state() accessor chosen: Chosen | undefined = undefined;

  /** How a restore is getting on, once it's started. */
  @state() accessor progress = "";

  @state() accessor restoring = false;

  @query("gw-dialog") accessor dialog: GwDialog | null = null;

  @query("input[type=file]") accessor fileInput: HTMLInputElement | null = null;

  override render() {
    return html`
      <a class="back" href=${homeHref}
        >${icon(mdiChevronLeft)}<span>${t("issue.back")}</span></a
      >
      <h1>${t("backups.title")}</h1>
      <p class="muted-text">${t("backups.intro")}</p>
      ${
        this.notice === undefined
          ? nothing
          : html`<gw-alert class="message" tone=${this.notice.tone}
              >${this.notice.text}</gw-alert
            >`
      }
      ${AsyncResult.matchWithError(this.#backups.value, {
        onInitial: () =>
          html`<p class="muted-text" role="status">${t("loading")}</p>`,
        onError: renderError,
        onDefect: renderDefect,
        onSuccess: ({ value }) => this.#renderBackups(value),
      })}
      <gw-dialog
        heading=${
          this.chosen === undefined
            ? ""
            : t("backups.restoreHeading", {
                name:
                  "name" in this.chosen
                    ? this.chosen.name
                    : this.chosen.file.name,
              })
        }
        close-label=${t("close")}
        @close=${this.#onDialogClose}
      >
        <p>${t("backups.restoreWarning")}</p>
        ${this.progress === "" ? nothing : html`<p>${this.progress}</p>`}
        <gw-button
          slot="actions"
          appearance="plain"
          variant="neutral"
          ?disabled=${this.restoring}
          @click=${() => this.dialog?.close()}
          >${t("backups.cancel")}</gw-button
        >
        <gw-button
          slot="actions"
          appearance="filled"
          variant="danger"
          icon=${mdiRestore}
          ?loading=${this.restoring}
          @click=${this.#startRestore}
          >${t("backups.restore")}</gw-button
        >
      </gw-dialog>
    `;
  }

  #renderBackups(kept: ReadonlyArray<Api.BackupFile>) {
    return html`
      <section>
        <h2>${t("backups.make")}</h2>
        <p class="muted-text">${t("backups.makeHint")}</p>
        <div class="actions">
          <gw-button
            icon=${mdiArchiveArrowDownOutline}
            ?loading=${this.#create.value.waiting}
            @click=${this.#make}
            >${t("backups.makeButton")}</gw-button
          >
        </div>
      </section>
      <section>
        <h2>${t("backups.kept")}</h2>
        <p class="muted-text">${t("backups.keptHint")}</p>
        ${
          kept.length === 0
            ? renderEmpty(mdiArchiveArrowDownOutline, t("backups.none"))
            : html`<table>
                <thead>
                  <tr>
                    <th>${t("backups.made")}</th>
                    <th class="name">${t("backups.name")}</th>
                    <th>${t("backups.size")}</th>
                    <th><span hidden>${t("backups.actions")}</span></th>
                  </tr>
                </thead>
                <tbody>
                  ${kept.map(
                    (backup) =>
                      html`<tr>
                        <td>${formatTime(backup.at)}</td>
                        <td class="name">${backup.name}</td>
                        <td class="size">${sizeText(backup.bytes)}</td>
                        <td class="row-actions">
                          <gw-button
                            size="small"
                            appearance="plain"
                            icon=${mdiDownload}
                            labels="hide"
                            ?disabled=${this.#link.value.waiting}
                            label=${t("backups.downloadNamed", { name: backup.name })}
                            @click=${() => void this.#download(backup.name)}
                            >${t("backups.download")}</gw-button
                          >
                          <gw-button
                            size="small"
                            appearance="plain"
                            icon=${mdiRestore}
                            labels="hide"
                            label=${t("backups.restoreNamed", { name: backup.name })}
                            @click=${() => this.#ask({ name: backup.name })}
                            >${t("backups.restore")}</gw-button
                          >
                          <gw-button
                            size="small"
                            appearance="plain"
                            variant="danger"
                            icon=${mdiDeleteOutline}
                            labels="hide"
                            ?disabled=${this.#remove.value.waiting}
                            label=${t("backups.deleteNamed", { name: backup.name })}
                            @click=${() => void this.#delete(backup.name)}
                            >${t("backups.delete")}</gw-button
                          >
                        </td>
                      </tr>`,
                  )}
                </tbody>
              </table>`
        }
      </section>
      <section>
        <h2>${t("backups.fromFile")}</h2>
        <p class="muted-text">${t("backups.fromFileHint")}</p>
        <div class="actions">
          <gw-button icon=${mdiUpload} @click=${() => this.fileInput?.click()}
            >${t("backups.fromFileButton")}</gw-button
          >
          <input
            type="file"
            accept=".triage-backup"
            hidden
            @change=${this.#onFile}
          />
        </div>
      </section>
    `;
  }

  readonly #make = async () => {
    this.notice = undefined;
    registry.set(createBackup, undefined);

    const exit = await run(createBackup);

    this.notice = Exit.isSuccess(exit)
      ? {
          text: t("backups.madeNotice", {
            name: exit.value.name,
            size: sizeText(exit.value.bytes),
          }),
          tone: "success",
        }
      : { text: failure(exit.cause), tone: "danger" };
  };

  /** Saves a kept backup through a one-time link, without leaving the page. */
  async #download(name: string) {
    this.notice = undefined;
    registry.set(backupLink, name);

    const exit = await run(backupLink);

    if (Exit.isFailure(exit)) {
      this.notice = { text: failure(exit.cause), tone: "danger" };

      return;
    }

    const link = document.createElement("a");

    link.href = new URL(exit.value.path, document.baseURI).href;
    link.download = name;
    link.click();
  }

  async #delete(name: string) {
    this.notice = undefined;
    registry.set(removeBackup, name);

    const exit = await run(removeBackup);

    if (Exit.isFailure(exit)) {
      this.notice = { text: failure(exit.cause), tone: "danger" };
    }
  }

  #ask(backup: Chosen) {
    this.chosen = backup;
    this.progress = "";
    this.dialog?.show();
  }

  readonly #onFile = (event: Event) => {
    const input = event.currentTarget;

    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    const file = input.files?.[0];

    input.value = "";

    if (file !== undefined) {
      this.#ask({ file });
    }
  };

  readonly #startRestore = async () => {
    const backup = this.chosen;

    if (backup === undefined || this.restoring) {
      return;
    }

    this.restoring = true;
    this.progress = t("backups.checking");

    const started =
      "name" in backup
        ? (registry.set(restoreBackup, backup.name), run(restoreBackup)).then(
            (exit) => {
              if (Exit.isFailure(exit)) {
                throw new Error(failure(exit.cause));
              }
            },
          )
        : uploadBackup(backup.file, (sent) => {
            this.progress =
              sent < backup.file.size
                ? t("backups.sending", {
                    sent: sizeText(sent),
                    size: sizeText(backup.file.size),
                  })
                : t("backups.checking");
          });

    try {
      await started;
    } catch (error) {
      this.progress = error instanceof Error ? error.message : String(error);
      this.restoring = false;

      return;
    }

    this.progress = t("backups.restarting");
    await reloadWhenBack();
  };

  /** While a restore runs, the dialog stays open. */
  readonly #onDialogClose = () => {
    if (this.restoring) {
      this.dialog?.show();
    }
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "triage-backups": TriageBackups;
  }
}
