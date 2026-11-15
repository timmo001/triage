/**
 * Builds the web UI into `dist/`, which the server serves: the page with its
 * script and styles, the service worker, and the manifest and icons from
 * `pwa.config.ts` and the logo. The page gets the manifest's link in its head.
 */
import { rm } from "node:fs/promises";
import path from "node:path";
import { headTags, writePwa } from "@timmo001/groundwork-pwa/build";
import packageJson from "../package.json" with { type: "json" };
import config from "./pwa.config.ts";

const root = import.meta.dir;
const outDir = path.join(root, "dist");

await rm(outDir, { recursive: true, force: true });

const failed = (logs: ReadonlyArray<unknown>): never => {
  for (const log of logs) {
    console.error(log);
  }

  process.exit(1);
};

const page = await Bun.build({
  entrypoints: [path.join(root, "index.html")],
  outdir: outDir,
  minify: true,
  conditions: ["bun"],
});

if (!page.success) {
  failed(page.logs);
}

// The page's hashed files, which the worker keeps from the first visit
const shell = page.outputs
  .map((output) => path.basename(output.path))
  .filter((name) => /-[a-z0-9]{8}\.\w+$/.test(name))
  .map((name) => `./${name}`);

const worker = await Bun.build({
  entrypoints: [path.join(root, "src/sw.ts")],
  outdir: outDir,
  target: "browser",
  minify: true,
  naming: { entry: "[name].[ext]" },
  define: {
    "process.env.TRIAGE_VERSION": JSON.stringify(packageJson.version),
    "process.env.TRIAGE_SHELL": JSON.stringify(JSON.stringify(shell)),
  },
});

if (!worker.success) {
  failed(worker.logs);
}

await writePwa(config, { outDir, logo: path.join(root, "favicon.svg") });

const indexFile = path.join(outDir, "index.html");

await Bun.write(
  indexFile,
  (await Bun.file(indexFile).text()).replace(
    "<head>",
    `<head>\n    ${headTags(config)}`,
  ),
);

console.log(
  `Built ${packageJson.version} into ${path.relative(process.cwd(), outDir)}/`,
);
