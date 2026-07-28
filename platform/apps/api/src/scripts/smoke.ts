/**
 * End-to-end smoke test against a running local API.
 *
 * Proves the Phase 1 vertical slice over real HTTP and a real SQLite file: create a
 * client, upload a QuickBooks-shaped P&L, commit it, read the report back, override a
 * value, and confirm a re-import supersedes that override while keeping its history.
 *
 * Run with the server up:  pnpm --filter @avilo/api exec tsx src/scripts/smoke.ts
 */
import * as XLSX from "xlsx";

const BASE = process.env.AVILO_API ?? "http://127.0.0.1:5178";

async function call(path: string, input: unknown, method: "query" | "mutation") {
  const url =
    method === "query"
      ? `${BASE}/trpc/${path}?input=${encodeURIComponent(JSON.stringify(input))}`
      : `${BASE}/trpc/${path}`;
  const response = await fetch(url, {
    method: method === "query" ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    ...(method === "mutation" ? { body: JSON.stringify(input) } : {}),
  });
  const body = (await response.json()) as any;
  if (body.error) {
    throw new Error(`${path}: ${body.error.message ?? JSON.stringify(body.error)}`);
  }
  return body.result?.data;
}

const query = (p: string, i: unknown = undefined) => call(p, i, "query");
const mutate = (p: string, i: unknown) => call(p, i, "mutation");

/** The same QuickBooks shape the parser tests use, as a real .xlsx buffer. */
function buildWorkbook(octRevenue: number): string {
  const rows = [
    ["Phoenix Restoration Co."],
    ["Profit and Loss"],
    ["October 2023 - October 2024"],
    [null, "Oct 2023", "Sep 2024", "Oct 2024", "Total"],
    ["Income"],
    ["  Restoration Services", 140000, 168000, 182400, 490400],
    ["Total for Income", 162000, 194000, octRevenue, 560000],
    ["Cost of Goods Sold"],
    ["  Subcontractors", 61000, 74000, 79000, 214000],
    ["Total for Cost of Goods Sold", 99000, 115000, 122000, 336000],
    ["Expenses"],
    ["  Payroll", 30000, 33000, 34000, 97000],
    ["Total for Expenses", 36000, 39200, 38800, 114000],
    ["Net Operating Income", 27000, 39800, 43200, 110000],
  ];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Sheet1");
  return XLSX.write(book, { type: "base64", bookType: "xlsx" });
}

function check(label: string, condition: boolean, detail = ""): void {
  if (condition) {
    process.stdout.write(`  PASS  ${label}\n`);
  } else {
    process.stdout.write(`  FAIL  ${label} ${detail}\n`);
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  const name = `Smoke Client ${Date.now()}`;
  process.stdout.write("\nAvilo Phase 1 smoke test\n\n");

  const { id: clientId } = await mutate("clients.create", { name });
  check("client created", Boolean(clientId));

  // --- stage
  const staged = await mutate("import.stage", {
    clientId,
    files: [{ filename: "PandL_Oct2024.xlsx", content: buildWorkbook(204000) }],
  });
  const file = staged[0];
  check(
    "file auto-classified as profit_and_loss",
    file.classification.reportType === "profit_and_loss",
    JSON.stringify(file.classification.reportType),
  );
  check(
    "classification confident enough to import without asking",
    file.classification.needsConfirmation === false,
    `confidence=${file.classification.confidence}`,
  );
  check(
    "all three month columns detected",
    JSON.stringify(file.preview.periods) === '["2023-10","2024-09","2024-10"]',
    JSON.stringify(file.preview.periods),
  );
  check(
    "trailing Total column ignored",
    file.preview.ignoredColumns.includes("Total"),
  );
  check("nothing written before commit", (await query("report.periods", { clientId })).length === 0);

  // --- commit
  const committed = await mutate("import.commit", {
    clientId,
    sourceFileId: file.sourceFileId,
  });
  check("facts written", committed.factsWritten > 0, `${committed.factsWritten}`);

  const report = await query("report.period", { clientId, period: "2024-10" });
  const revenue = report.accounts.find((a: any) => a.accountId === "pl.revenue");
  check("'Total for Income' resolved to revenue", revenue.value === 204000, `${revenue.value}`);
  check("provenance recorded", revenue.sourceColumnLabel === "Oct 2024", revenue.sourceColumnLabel);

  const metric = (id: string) => report.metrics.find((m: any) => m.id === id);
  check("gross profit computed", metric("gross_profit").value === 82000);
  check(
    "NOI computed",
    metric("net_operating_income").value === 204000 - 122000 - 38800,
  );

  // The derived checklist: no balance sheet was uploaded, so cash is missing and the
  // metric that needs it must say so in terms of the field the user has to supply.
  check(
    "days cash on hand reports its missing input",
    metric("days_cash_on_hand").status === "missing_inputs" &&
      metric("days_cash_on_hand").missing[0] === "bs.cash",
    JSON.stringify(metric("days_cash_on_hand").missing),
  );
  check(
    "checklist flags bs.cash as required but absent",
    report.missingRequired.includes("bs.cash") && report.complete === false,
  );

  // --- prior-year comparative, which the prototype read by hardcoded column index
  const priorYear = await query("report.period", { clientId, period: "2023-10" });
  check(
    "prior-year same month available as a query, not an index",
    priorYear.accounts.find((a: any) => a.accountId === "pl.revenue").value === 162000,
  );

  // --- override
  await mutate("overrides.set", {
    clientId,
    period: "2024-10",
    targetKind: "account",
    targetId: "pl.revenue",
    value: 195000,
    previousValue: 204000,
    reason: "Client confirmed a credit note",
  });
  const overridden = await query("report.period", { clientId, period: "2024-10" });
  const cell = overridden.accounts.find((a: any) => a.accountId === "pl.revenue");
  check("override displaces the fact", cell.value === 195000 && cell.source === "override");
  check("divergence from source is surfaced", cell.divergesFrom === 204000);
  check(
    "downstream metric recomputes from the override",
    overridden.metrics.find((m: any) => m.id === "gross_profit").value === 195000 - 122000,
  );

  // --- re-import with a different figure supersedes the override
  const restaged = await mutate("import.stage", {
    clientId,
    files: [{ filename: "PandL_Oct2024_v2.xlsx", content: buildWorkbook(210000) }],
  });
  const recommitted = await mutate("import.commit", {
    clientId,
    sourceFileId: restaged[0].sourceFileId,
  });
  check(
    "re-import supersedes the conflicting override",
    recommitted.supersededOverrides === 1,
    `${recommitted.supersededOverrides}`,
  );
  check("user is told what happened", /can be restored/.test(recommitted.notices.join(" ")));

  const after = await query("report.period", { clientId, period: "2024-10" });
  check(
    "fresh imported value now displays",
    after.accounts.find((a: any) => a.accountId === "pl.revenue").value === 210000,
  );

  const history = await query("overrides.list", { clientId, period: "2024-10" });
  const superseded = history.find((o: any) => o.status === "superseded");
  check("superseded override retained with its value", superseded?.value === 195000);
  check("supersession is attributed to a file", Boolean(superseded?.supersededBySourceFileId));

  await mutate("overrides.restore", { id: superseded.id });
  const restored = await query("report.period", { clientId, period: "2024-10" });
  check(
    "one-click restore brings the manual value back",
    restored.accounts.find((a: any) => a.accountId === "pl.revenue").value === 195000,
  );

  // --- global formula edit applies retroactively
  await mutate("formulas.update", {
    id: "gross_margin_pct",
    expression: "gross_profit / pl.revenue * 1000",
    note: "smoke test",
  });
  const edited = await query("report.period", { clientId, period: "2023-10" });
  check(
    "formula edit applies retroactively to an older period",
    Math.round(edited.metrics.find((m: any) => m.id === "gross_margin_pct").value) ===
      Math.round(((162000 - 99000) / 162000) * 1000),
  );
  await mutate("formulas.rollback", { id: "gross_margin_pct", version: 1 });

  // --- invalid formula edits are refused
  let refusedCycle = false;
  try {
    await mutate("formulas.update", {
      id: "gross_profit",
      expression: "gross_margin_pct + 1",
    });
  } catch {
    refusedCycle = true;
  }
  check("a formula edit creating a cycle is refused", refusedCycle);

  let refusedUnknown = false;
  try {
    await mutate("formulas.update", {
      id: "gross_profit",
      expression: "pl.revenue - pl.made_up",
    });
  } catch {
    refusedUnknown = true;
  }
  check("a formula edit referencing an unknown account is refused", refusedUnknown);

  // --- fiscal year default for export
  const range = await query("report.defaultExportRange", { clientId });
  check(
    "default export range is the current financial year to date",
    range.start === "2024-01" && range.end === "2024-10",
    JSON.stringify(range),
  );

  await mutate("clients.remove", { id: clientId });

  process.stdout.write(
    process.exitCode === 1 ? "\nSMOKE TEST FAILED\n\n" : "\nAll smoke checks passed.\n\n",
  );
}

main().catch((error) => {
  process.stderr.write(`\nSmoke test error: ${(error as Error).message}\n\n`);
  process.exit(1);
});
