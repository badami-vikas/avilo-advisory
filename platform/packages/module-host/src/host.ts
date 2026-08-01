/**
 * The host: one process, one port, many modules.
 *
 * Everything here is deliberately ignorant of what a module does. There is no mention of
 * clients, periods or financials in this file, and there should never be one — the day a
 * second module is registered, anything module-specific that leaked in here becomes a
 * special case that the second module has to work around.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { initTRPC, type AnyTRPCRouter } from "@trpc/server";

import type {
  BridgeModule,
  ModuleContext,
  ModuleRegistry,
  ModuleRouters,
  Surface,
} from "./contract.js";

/**
 * A separate tRPC instance from any module's.
 *
 * Routers built by different `initTRPC.create()` calls compose as long as their
 * transformer and error formatter agree; both sides use the defaults. Giving the host
 * its own instance keeps it from inheriting a module's context type, which would make
 * the second module's context the odd one out.
 */
const t = initTRPC.create();

export interface HostPaths {
  /** Parent of every module's user-visible files directory. */
  filesRoot: string;
  /** Parent of every module's private data directory. */
  dataRoot: string;
  /** Parent of every module's shipped read-only assets. */
  resourcesRoot: string;
}

export interface HostOptions {
  paths: HostPaths;
  surface: Surface;
  log?: (message: string) => void;
}

/**
 * The lifecycle half of a host — everything whose type does not depend on which modules
 * are registered.
 *
 * `router` is deliberately *not* in here. Declaring it as `AnyTRPCRouter` would compile
 * perfectly and silently reduce the entire front end to `any`, because the client types
 * itself from `typeof host.router`. It stays off the interface so that `createHost`'s
 * inferred return type is the only thing that describes it, carrying every module's
 * procedure signatures with it.
 */
export interface HostLifecycle<T extends ModuleRegistry> {
  readonly modules: T;
  readonly contexts: Record<keyof T & string, ModuleContext>;
  /** Runs every module's `init`, in registration order. */
  start(): Promise<void>;
  /** Runs every module's `dispose`, in reverse order. Safe to call twice. */
  stop(): Promise<void>;
  /** Per-module status for `/health` and the startup banner. */
  describe(): Record<string, Record<string, string>>;
}

/** What the transport needs: a mountable router and a lifecycle. */
export interface Host<T extends ModuleRegistry = ModuleRegistry>
  extends HostLifecycle<T> {
  readonly router: AnyTRPCRouter;
}

/**
 * Compose a registry of modules into a single mountable surface.
 *
 * No return annotation, on purpose — see `HostLifecycle`.
 */
export function createHost<T extends ModuleRegistry>(modules: T, options: HostOptions) {
  for (const [id, module] of Object.entries(modules)) {
    if (module.id !== id) {
      // A module mounted under a key that is not its own id would answer to one name in
      // the URL and report another in logs and health output. Cheap to check, genuinely
      // confusing to debug.
      throw new Error(
        `Module registered as "${id}" declares id "${module.id}". They must match.`,
      );
    }
    if (!/^[a-z][a-z0-9-]*$/.test(id)) {
      throw new Error(
        `Module id "${id}" must be lowercase alphanumeric with dashes: it names a URL segment and a directory.`,
      );
    }
  }

  const log = options.log ?? (() => {});

  const contexts = Object.fromEntries(
    Object.keys(modules).map((id) => [
      id,
      {
        id,
        // Files are user-visible, so they get the module's *title* case-preserved by the
        // caller via filesRoot; the id is used for the machine-owned directories only.
        filesRoot: ensureDir(join(options.paths.filesRoot, modules[id]!.title)),
        dataDir: ensureDir(join(options.paths.dataRoot, id)),
        resourcesDir: join(options.paths.resourcesRoot, id),
        surface: options.surface,
        log: (message: string) => log(`[${id}] ${message}`),
      } satisfies ModuleContext,
    ]),
  ) as Record<keyof T & string, ModuleContext>;

  const routers = Object.fromEntries(
    Object.entries(modules).map(([id, module]) => [id, module.router]),
  ) as ModuleRouters<T>;

  const router = t.router(routers);

  const started: BridgeModule[] = [];
  let stopped = false;

  return {
    modules,
    router,
    contexts,

    async start() {
      for (const [id, module] of Object.entries(modules)) {
        try {
          await module.init?.(contexts[id as keyof T & string]!);
          started.push(module);
        } catch (error) {
          // Unwind what did start. A half-initialised host that keeps running is how you
          // get a module holding a database handle it will never use and a lock nobody
          // can explain.
          await this.stop();
          throw new Error(
            `Module "${id}" failed to start: ${(error as Error).message}`,
            { cause: error },
          );
        }
      }
    },

    async stop() {
      if (stopped) return;
      stopped = true;
      for (const module of [...started].reverse()) {
        try {
          await module.dispose?.();
        } catch (error) {
          // Never let one module's failed shutdown strand the others'.
          log(`[${module.id}] dispose failed: ${(error as Error).message}`);
        }
      }
      started.length = 0;
    },

    describe() {
      return Object.fromEntries(
        Object.entries(modules).map(([id, module]) => [
          id,
          {
            title: module.title,
            ...(module.describe?.(contexts[id as keyof T & string]!) ?? {}),
          },
        ]),
      );
    },
  };
}

function ensureDir(path: string): string {
  mkdirSync(path, { recursive: true });
  return path;
}
