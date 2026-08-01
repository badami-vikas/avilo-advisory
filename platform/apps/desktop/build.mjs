#!/usr/bin/env node
/**
 * Assemble the desktop application's `dist/`.
 *
 * The main process is bundled rather than shipped as a tree of workspace packages. In a
 * pnpm workspace those packages are symlinks into a content-addressed store, and every
 * packager has to be talked into following them correctly; bundling removes the question
 * entirely. Two dependencies stay out of the bundle because bundling them is what breaks
 * them — see EXTERNAL below.
 */

import { build } from "esbuild";
import { cp, mkdir, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "dist");
const repo = join(here, "..", "..", "..");

/**
 * Left out of the bundle deliberately.
 *
 * - `electron` is provided by the runtime and must never be bundled.
 * - `better-sqlite3` is a native addon: the bundler cannot inline a `.node` binary, and
 *   the copy that ships has to match Electron's ABI, not Node's.
 * - `pdfjs-dist` resolves its standard font data at runtime with `require.resolve`.
 *   Bundled, that resolution points into the bundle and the import of a text-based PDF
 *   fails on a font it could not find — a failure that only appears with real files.
 */
const EXTERNAL = ["electron", "better-sqlite3", "pdfjs-dist"];

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });

  // The web bundle has to exist before we copy it. Building it here rather than assuming
  // it means `pnpm dist:mac` from a clean checkout produces a complete application.
  const web = join(repo, "platform", "apps", "web", "dist");
  if (!(await exists(join(web, "index.html")))) {
    throw new Error(
      `No web bundle at ${web}. Run \`pnpm --filter @avilo/web build\` first, or \`pnpm app:build\` from the repo root.`,
    );
  }

  await build({
    entryPoints: [join(here, "src", "main.ts")],
    outfile: join(dist, "main.mjs"),
    bundle: true,
    platform: "node",
    // Electron 43 ships Node 22.
    target: "node22",
    format: "esm",
    external: EXTERNAL,
    sourcemap: true,
    // `import.meta.url` is load-bearing in the main process (it resolves the resources
    // directory), so the ESM output format is not optional.
    //
    // But half the dependency tree below it is CommonJS — Fastify reaches avvio, which
    // calls `require("node:events")` — and an ES module has no `require` to reach for.
    // esbuild's interop shim looks for one in scope before giving up, so putting a real
    // one there is what makes an ESM bundle of a CJS tree actually load. Without this the
    // application throws "Dynamic require of node:events is not supported" before the
    // first window is created.
    banner: {
      js: [
        `import { createRequire as __createRequire } from "node:module";`,
        `const require = __createRequire(import.meta.url);`,
      ].join("\n"),
    },
    logLevel: "info",
  });

  await build({
    entryPoints: [join(here, "src", "preload.cts")],
    outfile: join(dist, "preload.cjs"),
    bundle: true,
    platform: "node",
    target: "node22",
    // A sandboxed preload is loaded as CommonJS. This is the one file that cannot be ESM.
    format: "cjs",
    external: ["electron"],
    logLevel: "info",
  });

  // Read-only assets, laid out the way `resourcesRoot()` and `webDist()` expect to find
  // them both in development (`dist/`) and packaged (`process.resourcesPath`).
  await cp(web, join(dist, "web"), { recursive: true });
  await cp(
    join(repo, "platform", "apps", "api", "migrations"),
    join(dist, "modules", "avilo", "migrations"),
    { recursive: true },
  );

  process.stdout.write(`\n  desktop bundle ready: ${dist}\n\n`);
}

main().catch((error) => {
  process.stderr.write(`\n${error.stack ?? error.message}\n\n`);
  process.exit(1);
});
