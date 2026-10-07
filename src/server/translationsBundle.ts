import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const translations = join(import.meta.dir, "..", "..", "web", "translations");

/**
 * The web UI's translations as JSON, by language, with the files' comments
 * left out. Imported as a Bun macro, so they end up inlined in the binary.
 */
export const bundleTranslations = (): Record<string, string> =>
  Object.fromEntries(
    readdirSync(translations)
      .filter((name) => name.endsWith(".jsonc"))
      .map((name) => [
        name.slice(0, -".jsonc".length),
        JSON.stringify(
          Bun.JSONC.parse(readFileSync(join(translations, name), "utf8")),
        ),
      ]),
  );
