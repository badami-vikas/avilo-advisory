import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import formbody from "@fastify/formbody";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";

import { appRouter } from "./router.js";
import { getConnection } from "./db.js";
import { BRIDGE_ROOT, DB_PATH } from "./paths.js";
import {
  COOKIE_NAME,
  checkPassword,
  clearFailures,
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
 * The built web bundle, when the API is serving it too.
 *
 * A single process is what makes a hosted deployment coherent: the browser talks to one
 * origin, `/trpc` is same-origin exactly as it is behind the Vite dev proxy, and the
 * session cookie covers both the app and its data. In development this directory does
 * not exist and Vite serves the front end instead.
 */
const WEB_DIST = resolve(
  process.env.AVILO_WEB_DIST ??
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "web", "dist"),
);

async function main(): Promise<void> {
  const auth = resolveAuth(HOST, process.env.AVILO_PASSWORD);

  getConnection();

  const app = Fastify({
    logger: { level: process.env.AVILO_LOG_LEVEL ?? "warn" },
    // QuickBooks exports are small, but a year of them in one upload is not.
    bodyLimit: 64 * 1024 * 1024,
    // Render and every other platform proxy terminate TLS upstream. Without this the
    // login throttle would see the proxy's address on every request and one attacker's
    // eight failures would lock out every user at once.
    trustProxy: !isLoopback(HOST),
  });

  await app.register(cors, {
    origin: [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/],
    credentials: true,
  });

  if (auth.enabled) {
    // The login form is a plain HTML form, so its body arrives URL-encoded rather than
    // as JSON. Registered only when the gate is on: nothing else in the API takes a form.
    await app.register(formbody);

    /**
     * Guard the data, not the code.
     *
     * The bundle contains no client figures, so it is served without a session; the
     * browser then fails its first tRPC call and lands on the login page. Guarding the
     * bundle instead would mean serving the login screen from inside the application
     * that cannot load until you have already logged in.
     */
    app.addHook("onRequest", async (request, reply) => {
      const path = request.url.split("?")[0] ?? "";
      if (!path.startsWith("/trpc")) return;
      if (verifySession(readCookie(request.headers.cookie, COOKIE_NAME), auth)) return;

      await reply
        .code(401)
        .header("WWW-Authenticate", 'Cookie realm="Avilo Advisory"')
        .send({ error: "Not signed in", loginUrl: "/login" });
    });

    app.get("/login", async (_request, reply) =>
      reply.type("text/html; charset=utf-8").send(loginPage(null)),
    );

    app.post<{ Body: { password?: string } | undefined }>(
      "/auth/login",
      async (request, reply) => {
        const address = request.ip;
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
  }

  await app.register(fastifyTRPCPlugin, {
    prefix: "/trpc",
    trpcOptions: { router: appRouter },
  });

  app.get("/health", () => ({
    ok: true,
    database: DB_PATH,
    files: BRIDGE_ROOT,
    authenticated: auth.enabled,
  }));

  const serveWeb = existsSync(join(WEB_DIST, "index.html"));
  if (serveWeb) {
    await app.register(fastifyStatic, { root: WEB_DIST });
    // The front end is a single-page app: /client/<id> is a client-side route, not a
    // file, so anything that is not an asset or an API call renders the shell.
    app.setNotFoundHandler((request, reply) => {
      if (request.method !== "GET" || request.url.startsWith("/trpc")) {
        return reply.code(404).send({ error: "Not found" });
      }
      return reply.sendFile("index.html");
    });
  }

  await app.listen({ port: PORT, host: HOST });

  process.stdout.write(
    [
      "",
      "  Avilo Advisory",
      `  http://${HOST}:${PORT}`,
      `  database  ${DB_PATH}`,
      `  files     ${BRIDGE_ROOT}`,
      `  web       ${serveWeb ? WEB_DIST : "served by Vite in development"}`,
      `  access    ${auth.enabled ? "passphrase required" : "open (loopback only)"}`,
      "",
    ].join("\n") + "\n",
  );
}

main().catch((error) => {
  process.stderr.write(`\n${(error as Error).message}\n\n`);
  process.exit(1);
});
