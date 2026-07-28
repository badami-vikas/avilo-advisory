import { defineConfig } from "drizzle-kit";

/**
 * Migrations are generated from the Drizzle schema rather than hand-written, so the SQL
 * applied at boot cannot drift from the TypeScript types the application compiles
 * against. `pnpm --filter @avilo/api migrations:generate` after any schema change.
 */
export default defineConfig({
  dialect: "sqlite",
  schema: "../../modules/avilo/src/schema.ts",
  out: "./migrations",
});
