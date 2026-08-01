/**
 * The HTTP transport for a host.
 *
 * Shared by both surfaces on purpose. The desktop shell and a served deployment differ
 * in exactly three things — the bind port, whether a login gate is installed, and where
 * the front-end bundle comes from — and all three are parameters here. Anything else
 * that differed between them would be a behaviour the desktop app has never been tested
 * with, discovered by a user.
 */

import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";

import type { ModuleRegistry } from "./contract.js";
import type { Host } from "./host.js";

export interface ServeOptions {
  /** 0 asks the OS for a free port — what the desktop shell wants. */
  port: number;
  host: string;
  /**
   * Built front-end bundle to serve at `/`. When absent (development, where Vite serves
   * it) the host answers API routes only.
   */
  webDist?: string | undefined;
  logLevel?: string | undefined;
  /**
   * Registered before anything else — an auth gate, a rate limiter, a CORS policy.
   * The host has no opinion about access control; the surface does.
   */
  configure?: (app: FastifyInstance) => Promise<void> | void;
  /**
   * Returns a reason to reject, or null to allow. Applied to `/trpc` only: the bundle
   * carries no data, and guarding it would mean serving the login screen from inside
   * the application you cannot load until you have logged in.
   */
  guard?: (
    headers: Record<string, string | string[] | undefined>,
  ) => { status: number; body: unknown } | null;
  bodyLimit?: number;
  trustProxy?: boolean;
}

export interface RunningHost {
  app: FastifyInstance;
  /** The port actually bound. Differs from the requested one whenever that was 0. */
  port: number;
  url: string;
  close(): Promise<void>;
}

export async function serveHost<T extends ModuleRegistry>(
  host: Host<T>,
  options: ServeOptions,
): Promise<RunningHost> {
  const app = Fastify({
    logger: { level: options.logLevel ?? "warn" },
    // A year of monthly exports can arrive in a single upload.
    bodyLimit: options.bodyLimit ?? 64 * 1024 * 1024,
    trustProxy: options.trustProxy ?? false,
  });

  await options.configure?.(app);

  if (options.guard) {
    const guard = options.guard;
    app.addHook("onRequest", async (request, reply) => {
      const path = request.url.split("?")[0] ?? "";
      if (!path.startsWith("/trpc")) return;
      const rejection = guard(request.headers as Record<string, string>);
      if (!rejection) return;
      await reply.code(rejection.status).send(rejection.body);
    });
  }

  await app.register(fastifyTRPCPlugin, {
    prefix: "/trpc",
    trpcOptions: { router: host.router },
  });

  app.get("/health", () => ({ ok: true, modules: host.describe() }));

  const webDist =
    options.webDist && existsSync(join(options.webDist, "index.html"))
      ? options.webDist
      : null;

  if (webDist) {
    await app.register(fastifyStatic, { root: webDist });
    // Single-page app: /client/<id> is a client-side route, not a file. Anything that is
    // not an asset and not an API call renders the shell.
    app.setNotFoundHandler((request, reply) => {
      if (request.method !== "GET" || request.url.startsWith("/trpc")) {
        return reply.code(404).send({ error: "Not found" });
      }
      return reply.sendFile("index.html");
    });
  }

  await host.start();
  await app.listen({ port: options.port, host: options.host });

  const address = app.server.address();
  const port =
    typeof address === "object" && address !== null ? address.port : options.port;

  return {
    app,
    port,
    url: `http://${options.host}:${port}`,
    async close() {
      await app.close();
      await host.stop();
    },
  };
}

/** True when `path` exists and is a directory. Used to validate resource roots. */
export function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
