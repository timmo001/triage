/**
 * The page's PWA connection: registers the service worker and holds the
 * browser's install prompt. Shared by the install offer and the update.
 */
import { connectPwa } from "@timmo001/groundwork-pwa/view";
import config from "../pwa.config.ts";

export const pwa = connectPwa(config);
