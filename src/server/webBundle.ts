import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const web = join(import.meta.dir, "..", "..", "web");

/** A built file: text as it is, or an image as base64. */
export interface WebFile {
  readonly body: string;
  readonly base64: boolean;
}

const binary = new Set(["png"]);

/**
 * Builds the web UI and returns its files by path under `dist`. Imported as a
 * Bun macro, so it runs while triage is bundled or loaded from source, and the
 * files end up inlined in the binary. Bun.build can't run inside a macro, hence
 * the child process.
 */
export const bundleWeb = (): Record<string, WebFile> => {
  const build = Bun.spawnSync([process.execPath, "run", "build"], {
    cwd: web,
    stdout: "ignore",
    stderr: "pipe",
  });

  if (!build.success) {
    throw new Error(`Couldn't build the web UI: ${build.stderr.toString()}`);
  }

  const dist = join(web, "dist");

  return Object.fromEntries(
    readdirSync(dist, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const file = join(entry.parentPath, entry.name);
        const base64 = binary.has(entry.name.split(".").pop() ?? "");

        return [
          file.slice(dist.length + 1),
          {
            body: readFileSync(file, base64 ? "base64" : "utf8"),
            base64,
          },
        ];
      }),
  );
};
