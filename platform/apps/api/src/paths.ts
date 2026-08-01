import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Where this module keeps things.
 *
 * These used to be module-level constants resolved from the environment at import time.
 * That works for exactly one module in exactly one process: it means the module decides
 * its own storage locations, and two modules in one host would race to name the same
 * directories. The host decides now, and calls `configurePaths` before anything opens a
 * file. The environment-variable defaults remain for the standalone dev path and for
 * tests, which have no host.
 */

export const ORGANIZATION = "Avilo Advisory";

interface Paths {
  filesRoot: string;
  dbPath: string;
  migrationsDir: string;
}

/**
 * The layout when nobody has configured one: a source checkout or a test run.
 *
 * `~/Documents/Bridge/<Organization>/` is the relationship-os local-files convention, and
 * `homedir()` resolves correctly on Windows too, so the desktop build inherits a sensible
 * default rather than a POSIX-shaped guess.
 */
function defaults(): Paths {
  const filesRoot =
    process.env.AVILO_FILES_ROOT ??
    join(homedir(), "Documents", "Bridge", ORGANIZATION);
  return {
    filesRoot,
    dbPath: process.env.AVILO_DB_PATH ?? join(filesRoot, ".data", "avilo.sqlite"),
    migrationsDir: join(dirname(fileURLToPath(import.meta.url)), "..", "migrations"),
  };
}

let configured: Paths | null = null;

/**
 * Point the module at host-provided locations. Must be called before the first database
 * or file access; the module descriptor's `init` is the only correct place.
 */
export function configurePaths(paths: Partial<Paths>): void {
  configured = { ...(configured ?? defaults()), ...paths };
}

function current(): Paths {
  configured ??= defaults();
  return configured;
}

/** Root of the user-visible file tree. Uploads live under here. */
export function filesRoot(): string {
  return current().filesRoot;
}

/** The SQLite database file. */
export function dbPath(): string {
  return current().dbPath;
}

/** Drizzle migrations, shipped with the code. */
export function migrationsDir(): string {
  return current().migrationsDir;
}

/** Per-client upload directory. */
export function clientFilesDir(clientName: string): string {
  return join(filesRoot(), sanitizeFolderName(clientName), "Source files");
}

/**
 * Make a client name safe as a folder component without mangling it beyond recognition —
 * the folder is user-visible in Finder and Explorer, so readability matters. The
 * character class already covers both platforms' reserved set.
 */
export function sanitizeFolderName(name: string): string {
  const cleaned = name
    .replace(/[\/\\:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "");
  return cleaned === "" ? "Unnamed client" : cleaned;
}

export function ensureDir(path: string): string {
  mkdirSync(path, { recursive: true });
  return path;
}
