/**
 * Avilo Advisory, as a module.
 *
 * Everything the application used to do to *itself* on startup — choose storage
 * locations, open the database, run migrations, seed reference data — happens here, in
 * response to a context the host supplies. Nothing in this file listens on a port or
 * reads an environment variable, which is what makes it safe to register alongside
 * another module in the same process.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { BridgeModule, ModuleContext } from "@bridge/module-host";

import { appRouter } from "./router.js";
import { closeConnection, getConnection } from "./db.js";
import { configurePaths, dbPath, filesRoot } from "./paths.js";

/**
 * The id namespaces the tRPC surface (`client.avilo.clients.list`) and names the private
 * data directory. It is written into URLs and directory names, so it is not free to
 * change later.
 */
export const AVILO_MODULE_ID = "avilo";

export const aviloModule: BridgeModule<typeof appRouter> = {
  id: AVILO_MODULE_ID,
  title: "Avilo Advisory",
  router: appRouter,

  init(context: ModuleContext) {
    // Migrations ship with the code, so their location depends on how the code was
    // packaged rather than on anything the host chose. A packaged desktop build unpacks
    // them into the host's resources tree; a source checkout has them next to `src`,
    // which is what `paths.ts` already resolves. Only override when the host really did
    // ship a copy — otherwise a missing directory here becomes "no migrations to run",
    // and the first query fails against an empty database instead.
    const hostMigrations = join(context.resourcesDir, "migrations");

    configurePaths({
      // User-visible: uploads land here and stay after uninstall.
      filesRoot: context.filesRoot,
      // Private: derived state, safe for the host to place wherever it keeps such things.
      dbPath: legacyDatabase() ?? join(context.dataDir, "avilo.sqlite"),
      ...(existsSync(hostMigrations) ? { migrationsDir: hostMigrations } : {}),
    });

    // Opening the connection runs migrations and seeds the canonical chart of accounts,
    // the formula registry and the built-in QuickBooks label dialects. Doing it here
    // rather than lazily on first request means a schema problem surfaces at startup,
    // where the host can refuse to come up, instead of inside someone's first click.
    getConnection();

    context.log(`database ${dbPath()}`);
    context.log(`files ${filesRoot()}`);
  },

  dispose() {
    closeConnection();
  },

  describe() {
    return { database: dbPath(), files: filesRoot() };
  },
};

/**
 * Where the database lived when Avilo chose its own paths: inside the user-visible files
 * folder, beside the uploads it describes.
 *
 * Adopted in place rather than moved. Every installed copy that predates the module host
 * has real client data in that file, and the two failure modes of moving it — a copy
 * interrupted halfway, and a stale `-wal` left behind at the old path — are both worse
 * than reading from where it already is. Nothing writes to the new location while this
 * returns a path, so there is no split-brain to reconcile later.
 */
function legacyDatabase(): string | null {
  const path = join(
    homedir(),
    "Documents",
    "Bridge",
    "Avilo Advisory",
    ".data",
    "avilo.sqlite",
  );
  return existsSync(path) ? path : null;
}
