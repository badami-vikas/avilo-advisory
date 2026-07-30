#!/usr/bin/env node
/**
 * Enforce the offline guarantee against the built bundle.
 *
 * "No internet or cloud dependency" was the first constraint on this project, and it is
 * the kind of property that decays silently: one dependency added months from now that
 * pulls a font from a CDN, and the promise is broken with nothing failing. So it is
 * checked against the actual build output rather than trusted.
 *
 * The bundle legitimately contains some absolute URLs — XML namespaces, licence headers,
 * and error strings in libraries that point at documentation. Those are inert text. What
 * matters is whether anything can *fetch* at runtime.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const dist = resolve("platform/apps/web/dist");

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

let files;
try {
  files = walk(dist);
} catch {
  process.stderr.write(`\n  No build found at ${dist}. Run \`pnpm build\` first.\n\n`);
  process.exit(1);
}

/**
 * Absolute URLs that appear in the bundle as text and are never requested. Each one was
 * checked in the built output before being listed; the note says where it lives, so a
 * future reader can re-verify rather than trust the list.
 */
const INERT = [
  // XML/SVG namespace identifiers. Never dereferenced.
  /^https?:\/\/www\.w3\.org\b/,
  /^https?:\/\/schema\.org\b/,
  // React builds this into an error message: "…error-decoder.html?invariant=" + code.
  /^https?:\/\/reactjs\.org\/docs\/error-decoder\.html\b/,
  // React Router warning text: "must be used within a data router. See …".
  /^https?:\/\/reactrouter\.com\/en\/main\/routers\b/,
  // Comment banners in the vendored CSS and chart library.
  /^https?:\/\/tailwindcss\.com\b/,
  /^https?:\/\/(www\.)?chartjs\.org\b/,
  // Licence headers and library documentation links.
  /^https?:\/\/(www\.)?mathjs\.org\b/,
  /^https?:\/\/github\.com\b/,
  /^https?:\/\/opensource\.org\b/,
  /^https?:\/\/(www\.)?apache\.org\b/,
];

const failures = [];

for (const file of files) {
  if (!/\.(js|css|html)$/.test(file)) continue;
  const source = readFileSync(file, "utf8");
  const name = file.slice(dist.length + 1);

  // Anything that could actually open a connection at runtime.
  for (const [pattern, why] of [
    [/\bnew\s+WebSocket\s*\(/g, "opens a WebSocket"],
    [/\bnew\s+XMLHttpRequest\s*\(/g, "uses XMLHttpRequest"],
    [/\bnew\s+EventSource\s*\(/g, "opens an EventSource"],
    [/\bnavigator\.sendBeacon\s*\(/g, "calls sendBeacon"],
    [/\bimportScripts\s*\(/g, "loads a remote script"],
  ]) {
    const hits = source.match(pattern);
    if (hits) failures.push(`${name}: ${why} (${hits.length}×)`);
  }

  // fetch() to an absolute origin. Same-origin relative paths — which is how /trpc is
  // called — are exactly what this application is supposed to do.
  for (const match of source.matchAll(/fetch\(\s*["'`](https?:\/\/[^"'`]+)/g)) {
    failures.push(`${name}: fetches an absolute URL ${match[1]}`);
  }

  // Assets referenced from markup must be local; a CDN link here is the classic
  // regression this file exists to catch.
  for (const match of source.matchAll(
    /(?:src|href)\s*=\s*["'](https?:\/\/[^"']+)["']/g,
  )) {
    failures.push(`${name}: references remote asset ${match[1]}`);
  }

  // Report any other absolute origin that is not on the inert list, so a new one has to
  // be looked at rather than blending in.
  for (const match of source.matchAll(/https?:\/\/[a-z0-9.-]+\.[a-z]{2,}[^\s"'`)]*/gi)) {
    const url = match[0];
    if (INERT.some((pattern) => pattern.test(url))) continue;
    if (/^https?:\/\/(127\.0\.0\.1|localhost)/.test(url)) continue;
    failures.push(`${name}: unrecognised external URL ${url}`);
  }
}

if (failures.length > 0) {
  process.stderr.write("\n  Offline audit FAILED\n\n");
  for (const failure of [...new Set(failures)]) {
    process.stderr.write(`    ${failure}\n`);
  }
  process.stderr.write(
    "\n  If one of these is inert text rather than network access, add it to INERT\n" +
      "  in scripts/audit-offline.mjs with a note explaining why.\n\n",
  );
  process.exit(1);
}

process.stdout.write(
  `\n  Offline audit passed — ${files.length} built files, no external hosts, ` +
    `no WebSocket, no XHR.\n\n`,
);
