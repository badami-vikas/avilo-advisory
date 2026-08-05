// QuickBooks group structure: a parent row, its children, and a "Total for <parent>" row.
//
// Every list-shaped export uses it — A/R and A/P ageing, Sales by Customer, and the
// sub-groups inside a P&L section:
//
//     Michael Hutchinson                    -184,107.55
//       STL0925-070WTR [Water]               375,065.30
//     Total for Michael Hutchinson           190,957.75
//
// Read naively that is three separate customers owing 381,915.50 between them. It is one
// customer owing 190,957.75. Both ageing and the customer ranking shipped with that
// defect: a beta user saw job codes listed as customers, and the same money counted twice
// on the same page.
//
// The rule is the one already used for balance-sheet and P&L accounts (ADR-008): the
// group total is authoritative and replaces the rows it covers, because it already
// contains them.

/**
 * The subject of a total row, or null if the row is not a total.
 *
 * `Total for Andrea Anthony` → `Andrea Anthony`
 * `Total Income`             → `Income`
 * `TOTAL`                    → `` (the grand total — subject is the whole report)
 */
export function totalRowSubject(label: string): string | null {
  const trimmed = label.trim();
  const match = /^totals?(?:\s+for)?\b\s*(.*)$/i.exec(trimmed);
  if (!match) return null;
  return (match[1] ?? "").trim();
}

/** True for the report's own grand total — `Total`, `TOTAL`, `Grand Total`. */
export function isGrandTotalRow(label: string): boolean {
  return /^(grand\s+)?totals?$/i.test(label.trim());
}

const same = (a: string, b: string): boolean =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Collapse `parent / children / Total for parent` runs into one entry per parent.
 *
 * Rows arrive in document order. On a `Total for X` row, everything from the row labelled
 * `X` onward is that group and is replaced by the total, which carries X's name.
 *
 * A parent that bills nothing directly prints as a bare label with no figures — the most
 * common case, and it must still be passed in, as a marker with `row: null`. Without it
 * there is nothing for the children to be spliced away from, and the group's job lines
 * survive alongside their own total. Markers that never meet a total carry no data and
 * are dropped.
 *
 * Nesting resolves naturally: the innermost total collapses first, and its result is then
 * a plain child of the group above it.
 */
export function collapseTotalGroups<T>(
  rows: { label: string; row: T | null }[],
): { label: string; row: T }[] {
  const out: { label: string; row: T | null }[] = [];

  for (const entry of rows) {
    const subject = totalRowSubject(entry.label);
    if (subject === null || subject === "") {
      out.push(entry);
      continue;
    }

    const start = out.findIndex((candidate) => same(candidate.label, subject));
    if (start >= 0) out.splice(start);
    out.push({ label: subject, row: entry.row });
  }

  return out.filter((entry): entry is { label: string; row: T } => entry.row !== null);
}
