/**
 * Report accounting-integrity findings for every period a client has.
 *
 * Separate from the importer on purpose: the checks are worth running against data that
 * is already in the store, including figures a person entered or overrode by hand, not
 * only against what a file happened to bring in.
 *
 *   pnpm --filter @avilo/api exec tsx src/scripts/check-integrity.ts
 */
import { eq } from "drizzle-orm";
import { checkIntegrity, formatPeriod } from "@avilo/module";
import { getDb, schema } from "../db.js";
import { availablePeriods } from "../services/report.js";

const db = getDb();
let total = 0;

for (const client of db.select().from(schema.clients).all()) {
  const findings: string[] = [];
  for (const period of availablePeriods(client.id)) {
    const values: Record<string, number> = {};
    for (const row of db
      .select()
      .from(schema.facts)
      .where(eq(schema.facts.clientId, client.id))
      .all()
      .filter((r) => r.period === period)) {
      values[row.accountId] = row.value;
    }
    for (const finding of checkIntegrity(values)) {
      findings.push(`    ${formatPeriod(period)} — ${finding.message}`);
    }
  }
  total += findings.length;
  process.stdout.write(
    `\n  ${client.name}: ${findings.length === 0 ? "no findings" : `${findings.length} finding(s)`}\n` +
      findings.join("\n") +
      (findings.length ? "\n" : ""),
  );
}

process.stdout.write(`\n  ${total} finding(s) in total.\n\n`);
