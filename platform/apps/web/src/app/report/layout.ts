/**
 * The report as data.
 *
 * Which sections exist, what order they run in, and which of them reach the PDF are a
 * stored value rather than the order they happen to appear in JSX. That is the same
 * "views as data" contract the tables use, applied to the report — and it is what lets
 * an advisor drop a section from a client-facing PDF without losing it from the working
 * page they use to produce that PDF.
 *
 * Two values, both editorial:
 *
 *   - `order`  — what comes after what. Dragged directly on the report.
 *   - `hidden` — sections taken out of it. They leave the page and land in a tray
 *                underneath, from which they can be dragged back.
 *
 * `hidden` used to be `excludedFromPrint`, and a hidden section still rendered on screen
 * with a note explaining that it would not print. That was a compromise to keep the
 * figures reachable for editing, and it is no longer needed: Raw data is its own view now
 * and edits every figure whether or not its section is in the report. Hiding a section
 * hides it, which is what the word means. Layouts written under the old key are read as
 * the new one — see `normalizeLayout`.
 *
 * Nothing is ever deleted. "Removing" a section adds its id to a list; restoring removes
 * it again. A section the layout has never heard of — one added by a later version —
 * appears in its default position rather than vanishing.
 */

export type ReportSectionId =
  | "key-insights"
  | "revenue-trend"
  | "top-expenses"
  | "at-a-glance"
  | "profitability"
  | "cash-position"
  | "ar-customers"
  | "ap-vendors"
  | "ar-ap-timing"
  | "service-lines"
  | "top-jobs"
  | "job-performance"
  | "referrals"
  | "gross-overhead"
  | "top-customers"
  | "flags";

export interface ReportSectionMeta {
  id: ReportSectionId;
  /** Shown in the format editor — matches the section's own heading. */
  label: string;
  /** What it is, for someone deciding whether a client should see it. */
  hint: string;
}

/**
 * Default order, and the printed report's spine.
 *
 * Taken from the v9 prototype's own PDF rather than invented: an advisor sending this to
 * a client every month has a shape they expect, and the narrative runs commentary →
 * trend → where the money went → headline figures → detail. The four sections after
 * `referrals` are additions this version makes; they sit at the end so the familiar part
 * of the document is unchanged.
 */
export const REPORT_SECTIONS: ReportSectionMeta[] = [
  {
    id: "key-insights",
    label: "Key Insights",
    hint: "Your written commentary for this month",
  },
  {
    id: "revenue-trend",
    label: "Revenue & Net Operating Income margin",
    hint: "The twelve-month trend chart",
  },
  {
    id: "top-expenses",
    label: "Top expenses this month",
    hint: "Largest five expense lines, excluding depreciation",
  },
  {
    id: "at-a-glance",
    label: "At a glance",
    hint: "Cash, margin and receivables in three figures",
  },
  {
    id: "profitability",
    label: "Did you make money this month?",
    hint: "Revenue, gross profit, overhead and net operating income",
  },
  {
    id: "cash-position",
    label: "Cash position",
    hint: "Cash in bank and days of runway",
  },
  {
    id: "ar-customers",
    label: "Who owes you money",
    hint: "Customer balances by ageing bucket",
  },
  {
    id: "ap-vendors",
    label: "What you owe",
    hint: "Vendor balances by ageing bucket",
  },
  {
    id: "ar-ap-timing",
    label: "A/R & A/P timing",
    hint: "Days sales outstanding and days payable outstanding",
  },
  {
    id: "service-lines",
    label: "Where your money came from",
    hint: "Revenue split by service line",
  },
  {
    id: "top-jobs",
    label: "Top 5 jobs this month",
    hint: "Highest-billing customers this period",
  },
  {
    id: "job-performance",
    label: "Job performance",
    hint: "Job counts and averages over the last twelve months",
  },
  {
    id: "referrals",
    label: "Top referral partners",
    hint: "Fees paid over the last 90 days",
  },
  {
    id: "gross-overhead",
    label: "Gross profit and overhead",
    hint: "Second trend chart — earned against cost to run",
  },
  {
    id: "top-customers",
    label: "Top customers",
    hint: "By revenue over the last twelve months",
  },
  {
    id: "flags",
    label: "Flags to review",
    hint: "Anything outside its benchmark band",
  },
];

export const DEFAULT_ORDER: ReportSectionId[] = REPORT_SECTIONS.map((s) => s.id);

export interface ReportLayout {
  order: ReportSectionId[];
  /** Taken out of the report. Lives in the tray beneath it until dragged back. */
  hidden: ReportSectionId[];
  /**
   * Print each chart's underlying figures as a table beneath it.
   *
   * Off by default, which is what the reference report does: a chart followed by twelve
   * rows of the numbers behind it doubles the length of the document and buries the
   * sections after it. Kept as an option rather than removed, because a client who
   * queries a figure wants exactly that table — and an advisor who knows they will be
   * asked would rather send it than field the email.
   */
  includeChartTables: boolean;
  /**
   * Print the registered entity name in brackets after the trading name.
   *
   * Off by default: most clients know themselves by the name on the invoice, and a
   * report headed with a registered entity they never use reads as someone else's
   * document. On when the report has to be unambiguous — anything going to a bank, an
   * auditor or a lender.
   */
  showLegalName: boolean;
}

export function defaultLayout(): ReportLayout {
  return {
    order: [...DEFAULT_ORDER],
    hidden: [],
    includeChartTables: false,
    showLegalName: false,
  };
}

/**
 * Repair a stored layout against the sections this build actually has.
 *
 * Stored layouts outlive the code that wrote them. A section removed since — or a typo
 * in a hand-edited config — must not leave a hole, and a section *added* since must not
 * be invisible just because an older layout did not list it. Both are resolved by
 * intersecting with the registry and then appending whatever is missing, in default
 * order, so a new section arrives where it was designed to sit.
 */
export function normalizeLayout(
  stored: (Partial<ReportLayout> & { excludedFromPrint?: string[] }) | null,
): ReportLayout {
  const known = new Set<string>(DEFAULT_ORDER);
  const seen = new Set<ReportSectionId>();

  const order: ReportSectionId[] = [];
  for (const id of stored?.order ?? []) {
    if (!known.has(id) || seen.has(id)) continue;
    seen.add(id);
    order.push(id);
  }
  for (const id of DEFAULT_ORDER) {
    if (!seen.has(id)) order.push(id);
  }

  // `excludedFromPrint` is the old name for the same list. Read it so a layout saved by
  // an earlier build keeps the advisor's choices instead of silently restoring every
  // section they had removed.
  const hidden = (stored?.hidden ?? stored?.excludedFromPrint ?? []).filter(
    (id): id is ReportSectionId => known.has(id),
  );

  return {
    order,
    hidden: [...new Set(hidden)],
    includeChartTables: stored?.includeChartTables === true,
    showLegalName: stored?.showLegalName === true,
  };
}

export function isHidden(layout: ReportLayout, id: ReportSectionId): boolean {
  return layout.hidden.includes(id);
}

export function toggleHidden(layout: ReportLayout, id: ReportSectionId): ReportLayout {
  return {
    ...layout,
    hidden: isHidden(layout, id)
      ? layout.hidden.filter((x) => x !== id)
      : [...layout.hidden, id],
  };
}

/**
 * Drop `id` immediately before `beforeId`, or at the end when that is null.
 *
 * What a drag actually means, as opposed to `moveSection`'s one-step nudge. Written as a
 * remove-then-insert on a copy so the index arithmetic cannot go wrong when the section
 * is moving forwards — splicing it out first is what makes the target index correct in
 * both directions.
 */
export function reorderSection(
  layout: ReportLayout,
  id: ReportSectionId,
  beforeId: ReportSectionId | null,
): ReportLayout {
  if (id === beforeId) return layout;
  const order = layout.order.filter((x) => x !== id);
  const target = beforeId === null ? order.length : order.indexOf(beforeId);
  if (target === -1) return layout;
  order.splice(target, 0, id);
  return { ...layout, order };
}

/** Move a section one place up or down. A no-op at either end rather than a wrap. */
export function moveSection(
  layout: ReportLayout,
  id: ReportSectionId,
  direction: -1 | 1,
): ReportLayout {
  const index = layout.order.indexOf(id);
  const target = index + direction;
  if (index === -1 || target < 0 || target >= layout.order.length) return layout;
  const order = [...layout.order];
  const [moved] = order.splice(index, 1);
  order.splice(target, 0, moved!);
  return { ...layout, order };
}

export function sectionMeta(id: ReportSectionId): ReportSectionMeta {
  return REPORT_SECTIONS.find((s) => s.id === id)!;
}
