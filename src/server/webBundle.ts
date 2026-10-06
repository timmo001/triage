import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const web = join(import.meta.dir, "..", "..", "web");

/**
 * Builds the web UI and returns its files. Imported as a Bun macro, so it runs
 * while triage is bundled or loaded from source, and the files end up inlined
 * in the binary. Bun.build can't run inside a macro, hence the child process.
 */
export const bundleWeb = (): Record<string, string> => {
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
    readdirSync(dist).map((name) => [
      name,
      readFileSync(join(dist, name), "utf8"),
    ]),
  );
};
