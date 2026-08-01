/**
 * The served surface: one process, listening on a port, for development and for a
 * deployment behind a proxy.
 *
 * The desktop application does not go through this file. Both surfaces build the same
 * host from the same registry and serve it with the same transport; what lives here is
 * only what is true of a *listening* server — a fixed port, a bind address that might
 * not be loopback, and therefore a login gate.
 */

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import cors from "@fastify/cors";
import formbody from "@fastify/formbody";
import { serveHost } from "@bridge/module-host";

import { buildHost, defaultPaths } from "./host.js";
import {
  COOKIE_NAME,
  checkPassword,
  clearFailures,
  clientAddress,
  clearedCookie,
  isLoopback,
  issueSession,
  readCookie,
  recordFailure,
  resolveAuth,
  sessionCookie,
  throttle,
  verifySession,
} from "./auth.js";
import { loginPage } from "./login-page.js";

// AVILO_PORT first: it is the explicit choice. PORT is the convention hosting platforms
// use to assign one, but it is also set by all sorts of local tooling, and letting an
// ambient PORT outrank a deliberate setting puts the API on whatever port happened to be
// in the environment — in development, the web server's.
const PORT = Number(process.env.AVILO_PORT ?? process.env.PORT ?? 5178);

// Loopback by default. The application makes no outbound requests and, unless a
// passphrase is configured, has no access control at all — so binding anywhere else has
// to be a deliberate act, and `resolveAuth` refuses to let it be a silent one.
const HOST = process.env.AVILO_HOST ?? "127.0.0.1";

/**
 * Set when a tunnel is publishing this process. The bind address stays 127.0.0.1 in that
 * mode, so it cannot be inferred — and getting it wrong means serving client financials
 * to the internet with no login.
 */
const BEHIND_PROXY = process.env.AVILO_BEHIND_CLOUDFLARE === "1";

const WEB_DIST = resolve(
  process.env.AVILO_WEB_DIST ??
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "web", "dist"),
);

async function main(): Promise<void> {
  const auth = resolveAuth(HOST, process.env.AVILO_PASSWORD, BEHIND_PROXY);

  const host = buildHost({
    paths: {
      ...defaultPaths(),
      // Migrations live next to this file in a source checkout; `paths.ts` finds them
      // itself when the host has not shipped a copy.
      resourcesRoot: join(dirname(fileURLToPath(import.meta.url)), "..", "resources"),
    },
    surface: "server",
    log: (message) => process.stdout.write(`  ${message}\n`),
  });

  const running = await serveHost(host, {
    port: PORT,
    host: HOST,
    webDist: WEB_DIST,
    logLevel: process.env.AVILO_LOG_LEVEL,
    // Every platform proxy terminates TLS upstream. Without this the login throttle
    // would see the proxy's address on every request, and one attacker's eight failures
    // would lock out every user at once.
    trustProxy: !isLoopback(HOST),

    configure: async (app) => {
      await app.register(cors, {
        origin: [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/],
        credentials: true,
      });

      if (!auth.enabled) return;

      // The login form posts URL-encoded, not JSON. Registered only when the gate is on:
      // nothing else in the API takes a form.
      await app.register(formbody);

      app.get("/login", async (_request, reply) =>
        reply.type("text/html; charset=utf-8").send(loginPage(null)),
      );

      app.post<{ Body: { password?: string } | undefined }>(
        "/auth/login",
        async (request, reply) => {
          const address = clientAddress(request.headers, request.ip, BEHIND_PROXY);
          const gate = throttle(address);
          if (!gate.allowed) {
            return reply
              .code(429)
              .type("text/html; charset=utf-8")
              .header("Retry-After", String(gate.retryAfter))
              .send(
                loginPage(
                  `Too many attempts. Try again in ${Math.ceil(gate.retryAfter / 60)} minutes.`,
                ),
              );
          }

          const submitted =
            typeof request.body?.password === "string" ? request.body.password : "";

          if (!checkPassword(submitted, auth)) {
            recordFailure(address);
            return reply
              .code(401)
              .type("text/html; charset=utf-8")
              .send(loginPage("That passphrase is not correct."));
          }

          clearFailures(address);
          return reply
            .header("Set-Cookie", sessionCookie(issueSession(auth), auth))
            .redirect("/", 303);
        },
      );

      app.post("/auth/logout", async (_request, reply) =>
        reply.header("Set-Cookie", clearedCookie(auth)).redirect("/login", 303),
      );
    },

    /**
     * Guard the data, not the code.
     *
     * The bundle contains no client figures, so it is served without a session; the
     * browser then fails its first tRPC call and lands on the login page. Guarding the
     * bundle instead would mean serving the login screen from inside the application
     * that cannot load until you have already logged in.
     */
    guard: auth.enabled
      ? (headers) => {
          const cookie = headers.cookie;
          const session = readCookie(
            typeof cookie === "string" ? cookie : undefined,
            COOKIE_NAME,
          );
          if (verifySession(session, auth)) return null;
          return { status: 401, body: { error: "Not signed in", loginUrl: "/login" } };
        }
      : undefined,
  });

  const status: Record<string, string> = host.describe().avilo ?? {};
  process.stdout.write(
    [
      "",
      "  Avilo Advisory",
      `  ${running.url}`,
      `  database  ${status.database}`,
      `  files     ${status.files}`,
      `  access    ${auth.enabled ? "passphrase required" : "open (loopback only)"}`,
      "",
    ].join("\n") + "\n",
  );

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void running.close().then(() => process.exit(0));
    });
  }
}

main().catch((error) => {
  process.stderr.write(`\n${(error as Error).message}\n\n`);
  process.exit(1);
});
