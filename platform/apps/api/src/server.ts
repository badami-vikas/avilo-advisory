import Fastify from "fastify";
import cors from "@fastify/cors";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";

import { appRouter } from "./router.js";
import { getConnection } from "./db.js";
import { BRIDGE_ROOT, DB_PATH } from "./paths.js";

const PORT = Number(process.env.AVILO_PORT ?? 5178);
// Loopback only. This application makes no outbound requests and accepts none from off
// the machine; binding to 0.0.0.0 would expose a client's financials to the LAN.
const HOST = "127.0.0.1";

async function main(): Promise<void> {
  getConnection();

  const app = Fastify({
    logger: { level: process.env.AVILO_LOG_LEVEL ?? "warn" },
    // QuickBooks exports are small, but a year of them in one upload is not.
    bodyLimit: 64 * 1024 * 1024,
  });

  await app.register(cors, { origin: [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/] });

  await app.register(fastifyTRPCPlugin, {
    prefix: "/trpc",
    trpcOptions: { router: appRouter },
  });

  app.get("/health", () => ({
    ok: true,
    database: DB_PATH,
    files: BRIDGE_ROOT,
    offline: true,
  }));

  await app.listen({ port: PORT, host: HOST });

  process.stdout.write(
    [
      "",
      "  Avilo Advisory — local API",
      `  http://${HOST}:${PORT}`,
      `  database  ${DB_PATH}`,
      `  files     ${BRIDGE_ROOT}`,
      "",
    ].join("\n") + "\n",
  );
}

main().catch((error) => {
  process.stderr.write(`Failed to start: ${(error as Error).stack}\n`);
  process.exit(1);
});
