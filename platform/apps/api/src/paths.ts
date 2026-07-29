import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

/**
 * Local file locations.
 *
 * User-visible files live under ~/Documents/Bridge/<Organization>/<Module>/<Sub-module>/
 * per the relationship-os local-files rule, so uploads land where the platform will
 * expect them after integration rather than in an app-private directory that would need
 * migrating.
 */
export const ORGANIZATION = "Avilo Advisory";

/**
 * A hosted deployment has no Documents folder worth writing to, and its filesystem is
 * usually replaced on every deploy — so the root is overridable and pointed at a mounted
 * disk. Left unset, the local-first path is unchanged.
 */
export const BRIDGE_ROOT =
  process.env.AVILO_FILES_ROOT ?? join(homedir(), "Documents", "Bridge", ORGANIZATION);

/** The SQLite database. Kept beside the files it describes. */
export const DATA_DIR = join(BRIDGE_ROOT, ".data");

export const DB_PATH = process.env.AVILO_DB_PATH ?? join(DATA_DIR, "avilo.sqlite");

/** Per-client upload directory. */
export function clientFilesDir(clientName: string): string {
  return join(BRIDGE_ROOT, sanitizeFolderName(clientName), "Source files");
}

/**
 * Make a client name safe as a folder component without mangling it beyond recognition —
 * the folder is user-visible in Finder, so readability matters.
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
