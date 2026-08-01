/**
 * The registry: which modules this build ships with.
 *
 * Adding relationship-os, or any second module, is adding a key here — the host mounts
 * it under its own name, hands it its own directories, and the front end reaches it at
 * `client.<id>`. Nothing in the transport, the shell, or the packaging changes.
 */

import { homedir } from "node:os";
import { join } from "node:path";

import { createHost, type HostPaths, type Surface } from "@bridge/module-host";

import { aviloModule } from "./module.js";

export const MODULES = {
  avilo: aviloModule,
} as const;

/**
 * The composed root router.
 *
 * Exported as a type for the front end, which types its client against it and therefore
 * gets `client.avilo.clients.list` — module boundaries visible in the call, checked by
 * the compiler, and unambiguous the moment there is more than one.
 */
export type HostRouter = ReturnType<typeof buildHost>["router"];

export function buildHost(options: {
  paths: HostPaths;
  surface: Surface;
  log?: (message: string) => void;
}) {
  return createHost(MODULES, options);
}

/**
 * Default locations when the host is not a packaged application.
 *
 * Files stay under Documents where the user can reach them; private state sits in a
 * dotted subdirectory beside them rather than somewhere they would have to be told
 * about. `homedir()` is correct on Windows as well as macOS.
 */
export function defaultPaths(): HostPaths {
  const bridge = join(homedir(), "Documents", "Bridge");
  return {
    filesRoot: bridge,
    dataRoot: join(bridge, ".data"),
    resourcesRoot: join(bridge, ".data", "resources"),
  };
}
