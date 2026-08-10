/**
 * The MCP server's data-isolation guarantee, enforced rather than asserted.
 *
 * The promise made to the user is that an external agent reaching this app over MCP can
 * read and change *configuration* and can never see a client's books. A promise like that
 * is worth exactly as much as the thing that catches it being broken, and a code review is
 * not that thing — the failure mode is someone adding a convenient import to a service the
 * server already depends on, three files away, months from now.
 *
 * So this walks the actual transitive import graph from `src/server.ts` and fails if any
 * reachable first-party file issues a query against a client-data table. Adding one breaks
 * the build, which is the only version of this guarantee that survives contact with time.
 *
 * The detected pattern is `schema.<clientTable>` — how every query in this codebase names a
 * table. It deliberately does not match `schema.ts`'s own `export const facts = ...`
 * definitions: defining the table is not reading it, and the schema module is imported by
 * everything.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..", "..");

/** Tables holding a client's own data. Reaching any of these from the MCP graph is the bug. */
const CLIENT_DATA_TABLES = [
  "facts",
  "clients",
  "overrides",
  "sourceFiles",
  "detailRows",
  "periodNotes",
  "summaryEdits",
  "stickyNotes",
] as const;

/** Workspace packages whose source counts as first-party and is walked. */
const WORKSPACE_ROOTS: Record<string, string> = {
  "@avilo/api": "platform/apps/api/src",
  "@avilo/core": "platform/packages/core/src",
  "@avilo/module": "platform/modules/avilo/src",
  "@avilo/tables": "platform/packages/tables/src",
};

function resolveImport(specifier: string, fromFile: string): string | null {
  const candidates: string[] = [];

  if (specifier.startsWith(".")) {
    const base = resolve(dirname(fromFile), specifier);
    candidates.push(base.replace(/\.js$/, ".ts"), `${base}.ts`, join(base, "index.ts"));
  } else {
    for (const [pkg, root] of Object.entries(WORKSPACE_ROOTS)) {
      if (specifier !== pkg && !specifier.startsWith(`${pkg}/`)) continue;
      const abs = join(repoRoot, root);
      if (specifier === pkg) {
        candidates.push(join(abs, "index.ts"));
      } else {
        // "@avilo/api/services/blueprint" -> <root>/services/blueprint.ts
        const sub = specifier.slice(pkg.length + 1).replace(/^services\//, "services/");
        candidates.push(join(abs, `${sub}.ts`), join(abs, sub, "index.ts"), join(abs, `${sub.replace(/\.js$/, "")}.ts`));
      }
    }
    // Anything else is a third-party dependency; not first-party source, not walked.
    if (candidates.length === 0) return null;
  }

  return candidates.find((c) => existsSync(c)) ?? null;
}

function importSpecifiers(source: string): string[] {
  const found: string[] = [];
  const patterns = [
    /\bimport\s+[^"';]*?\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bexport\s+[^"';]*?\bfrom\s*["']([^"']+)["']/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) found.push(match[1]!);
  }
  return found;
}

function walkGraph(entry: string): Map<string, string> {
  const seen = new Map<string, string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    const source = readFileSync(file, "utf8");
    seen.set(file, source);
    for (const specifier of importSpecifiers(source)) {
      const resolved = resolveImport(specifier, file);
      if (resolved && !seen.has(resolved)) queue.push(resolved);
    }
  }
  return seen;
}

describe("MCP server data isolation", () => {
  const entry = join(here, "..", "src", "server.ts");
  const graph = walkGraph(entry);

  it("walks a graph big enough for the check to mean something", () => {
    /*
      Guards against the whole suite passing vacuously. If module resolution silently broke,
      the graph would be one file and every assertion below would trivially hold — the test
      would go green precisely when it had stopped testing anything.
    */
    expect(graph.size).toBeGreaterThan(6);
    const names = [...graph.keys()].map((f) => f.replace(`${repoRoot}/`, ""));
    expect(names).toContain("platform/apps/api/src/services/blueprint.ts");
    expect(names).toContain("platform/apps/api/src/services/versions.ts");
    expect(names).toContain("platform/apps/api/src/db.ts");
  });

  it("reaches no query against any client-data table", () => {
    const offences: string[] = [];
    for (const [file, source] of graph) {
      for (const table of CLIENT_DATA_TABLES) {
        if (new RegExp(`schema\\.${table}\\b`).test(source)) {
          offences.push(`${file.replace(`${repoRoot}/`, "")} references schema.${table}`);
        }
      }
    }
    expect(offences).toEqual([]);
  });

  it("does not reach the report or copilot services at all", () => {
    /*
      Belt and braces on top of the table check. These two modules are where every client
      query in the application lives; if either ever appears in this graph, the isolation
      argument has been lost even if that day's code happens not to name a table.
    */
    const names = [...graph.keys()].map((f) => f.replace(`${repoRoot}/`, ""));
    expect(names).not.toContain("platform/apps/api/src/services/report.ts");
    expect(names).not.toContain("platform/apps/api/src/services/copilot.ts");
    expect(names).not.toContain("platform/apps/api/src/services/import.ts");
    expect(names).not.toContain("platform/apps/api/src/router.ts");
    /*
      The in-app assistant's client-scoped levers — sticky notes, action assignments, client
      metadata, one client's report layout. These write rows belonging to a client, which is
      exactly what an external agent may not reach, and the temptation to import them from
      `blueprint.ts` for convenience is precisely the drift this whole file exists to catch.
      The table check below would already fail on it; naming the module says why.
    */
    expect(names).not.toContain("platform/apps/api/src/services/client-levers.ts");
  });
});
