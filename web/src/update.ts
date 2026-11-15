/**
 * Moving the page onto a new release. The server refuses a page from another
 * version, so once it does, the service worker checks for the new build, which
 * keeps its files and takes over by itself, and the page reloads onto them.
 * Without a worker, such as over plain HTTP on the network, the reload fetches
 * them itself. It does this once per version by itself, then leaves it to the
 * banner's Reload button.
 */
import packageJson from "../../package.json" with { type: "json" };
import { pwa } from "./pwa.js";

/** The version this page was built as. */
export const version: string = packageJson.version;

const reloadedKey = "triage:reloaded-for-version";

/** How long a new worker gets to take over before the page reloads anyway. */
const takeOverTimeout = 10_000;

let updating = false;

let stale = false;

let whenStale = () => {};

/** Runs `listener` when the page couldn't move onto the server's release by itself. */
export const onStale = (listener: () => void) => {
  whenStale = listener;
};

/** Reloads the page onto the server's release, once the worker has it. */
const reloadForUpdate = async () => {
  const registration = await pwa.worker;

  if (
    registration !== undefined &&
    navigator.serviceWorker.controller !== null
  ) {
    const takenOver = new Promise<void>((resolve) => {
      navigator.serviceWorker.addEventListener("controllerchange", () =>
        resolve(),
      );
      setTimeout(resolve, takeOverTimeout);
    });

    await registration.update().catch(() => undefined);

    if (registration.installing !== null || registration.waiting !== null) {
      await takenOver;
    }
  }

  location.reload();
};

/**
 * Called when the server says it runs another version than this page. Every
 * call refused meanwhile waits on the same move.
 */
export const mismatched = () => {
  if (updating || stale) {
    return;
  }

  if (sessionStorage.getItem(reloadedKey) !== version) {
    sessionStorage.setItem(reloadedKey, version);
    updating = true;
    void reloadForUpdate();

    return;
  }

  stale = true;
  whenStale();
};
