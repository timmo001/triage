/**
 * The offer to install Triage as an app, where the browser can: a banner until
 * it's turned down once, either with Not now or in the browser's own prompt,
 * and an Install button in the header for as long as the browser can, which is
 * the only place left to install from once the banner's dismissed.
 */
import { pwa } from "./pwa.js";

const dismissedKey = "triage:install-dismissed";

/** Whether the browser has an install prompt to show. */
export const canInstall = () => pwa.canInstall();

/** Whether the banner has been turned down. */
export const dismissed = () => localStorage.getItem(dismissedKey) !== null;

export const turnDown = () =>
  localStorage.setItem(dismissedKey, new Date().toISOString());

/** Shows the browser's install prompt, and counts turning it down as Not now. */
export const install = async () => {
  if ((await pwa.install()) === "dismissed") {
    turnDown();
  }
};

/**
 * Runs `listener` when the browser offers an install prompt, takes it back once
 * it's used, or offers another later. Returns a function that stops listening.
 */
export const onInstallChange = (listener: () => void) => {
  window.addEventListener("gw-install-change", listener);

  return () => window.removeEventListener("gw-install-change", listener);
};
