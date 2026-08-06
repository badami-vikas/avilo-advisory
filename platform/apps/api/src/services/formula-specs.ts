/**
 * Loading formula definitions, split out of `report.ts` on purpose.
 *
 * This is a one-function module because of who needs to import it. `blueprint.ts` needs
 * the formula list to compile a newly created expression; `report.ts` needs it to evaluate
 * metrics for a client. Left where it was, importing it dragged the whole of `report.ts`
 * — and therefore every fact, override and client query in the application — into the
 * module graph of anything that touched blueprints.
 *
 * That mattered the moment the MCP server existed. Its guarantee is that an external agent
 * reaches configuration and never a client's books, and a guarantee worth having is one the
 * module graph enforces rather than one a reviewer remembers. `test/mcp-isolation.test.ts`
 * walks the server's transitive imports and fails if any of them can name a fact table;
 * this split is what lets that test pass without weakening it (ADR-043).
 */
import { getDb, schema } from "../db.js";
import type { FormulaSpec } from "@avilo/module";

export function loadFormulaSpecs(): FormulaSpec[] {
  const db = getDb();
  return db
    .select()
    .from(schema.formulas)
    .orderBy(schema.formulas.sortOrder)
    .all()
    .map((f) => ({
      id: f.id,
      label: f.label,
      expression: f.expression,
      unit: f.unit,
      active: f.active,
    }));
}
