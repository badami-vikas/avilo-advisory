/**
 * What a Bridge module is, and what a host owes it.
 *
 * Avilo Advisory was built as an application: it decided its own port, its own storage
 * locations, and mounted its own tRPC router at the root of its own server. None of
 * those decisions survive being merged with a second module — two modules cannot both
 * own `/trpc`, and neither of them should be choosing where a desktop shell keeps its
 * data.
 *
 * So the decisions move up. A module declares an identity and a router; the host hands
 * back the paths it is allowed to write to and mounts its router under its own name.
 * Registering a second module is then adding a key to a record, not merging two servers.
 */

import type { AnyTRPCRouter } from "@trpc/server";

/** How the host is presenting its modules. */
export type Surface = "desktop" | "server";

/**
 * Everything a module is allowed to assume about its environment.
 *
 * Deliberately all absolute paths and no environment variables. A module that reads
 * `process.env` directly is a module that behaves differently depending on who started
 * it, which is exactly the property that makes two of them hard to run in one process.
 */
export interface ModuleContext {
  /** The module's own id, as registered. */
  readonly id: string;

  /**
   * User-visible files, already created.
   *
   * On the desktop this is under the user's Documents folder on purpose: uploads and
   * exports are theirs, they should be able to find them in Finder or Explorer without
   * the application running, and they should survive uninstalling it.
   */
  readonly filesRoot: string;

  /**
   * Private state — databases, caches, indexes. Already created.
   *
   * Not user-visible and not user-editable. Deleting it should cost the user their
   * derived state and nothing else.
   */
  readonly dataDir: string;

  /**
   * Read-only assets shipped alongside the module's code: migrations, templates,
   * reference data. Resolved by the host because a packaged application does not have
   * the same layout as a source checkout.
   */
  readonly resourcesDir: string;

  readonly surface: Surface;

  /** Structured enough for a log file, plain enough for a terminal. */
  log(message: string): void;
}

/**
 * A module: an identity, a tRPC router, and an optional lifecycle.
 *
 * There is no `port`, no `listen`, and no `express`/`fastify` instance here by design.
 * A module that can open a socket is a module that will, and the second one to try will
 * fail at a moment nobody is watching.
 */
export interface BridgeModule<TRouter extends AnyTRPCRouter = AnyTRPCRouter> {
  /**
   * URL-safe and stable. It namespaces the tRPC surface (`client.avilo.clients.list`)
   * and names the data directory, so changing it later is a migration, not a rename.
   */
  readonly id: string;

  /** Shown in menus, window titles and module pickers. */
  readonly title: string;

  readonly router: TRouter;

  /**
   * Open databases, run migrations, warm caches. Runs once, before the host listens, so
   * a module that cannot start prevents the host from claiming it did.
   */
  init?(context: ModuleContext): void | Promise<void>;

  /** Flush and close. Runs on quit, and on failure of a later module's `init`. */
  dispose?(): void | Promise<void>;

  /**
   * A one-line status for the host's `/health` endpoint and its startup banner. Kept
   * free of anything a support log should not contain.
   */
  describe?(context: ModuleContext): Record<string, string>;
}

/** A registry of modules, keyed by the id they will be mounted under. */
export type ModuleRegistry = Record<string, BridgeModule>;

/** The shape `t.router()` is given when the host composes a registry. */
export type ModuleRouters<T extends ModuleRegistry> = {
  [K in keyof T]: T[K]["router"];
};
