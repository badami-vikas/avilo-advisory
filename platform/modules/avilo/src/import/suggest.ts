// AI-assisted label mapping.
//
// This is the layer where a cloud model actually earns its place. Report-type
// classification is a signature-matching problem with six stable answers and the rules
// solve it at full confidence; row-label mapping is open-vocabulary — every bookkeeper
// names their chart of accounts differently, and no seed table can enumerate that.
//
// Two invariants, both deliberate:
//
//   * The model chooses from the canonical account list or answers "skip". It cannot
//     invent an account, so a hallucination degrades to "unmapped", which is the same
//     state the user was already in.
//   * A suggestion is never written to the fact store. It pre-fills the dropdown the
//     user was going to use anyway, and only becomes a persisted mapping when accepted —
//     at which point it is learned and never asked again.

/**
 * Accounting domain knowledge sent with every mapping request.
 *
 * This is the "skill" a cloud model can actually use. A model reached over HTTP has no
 * filesystem and no plugin loader — it sees the prompt and nothing else — so domain
 * expertise has to travel *inside* the request. That is all a skill file ever was:
 * instructions, written down, loaded at the point of use.
 *
 * Held as data rather than woven into the prompt builder for the same reason formulas are
 * stored rather than compiled in: mapping accuracy is tuned by editing this text, and
 * editing it must not require shipping a new binary. `settings.accounting_guidance`
 * overrides it at runtime.
 */
export const ACCOUNTING_GUIDANCE = `You are an experienced bookkeeper mapping a client's chart of accounts onto a fixed set of canonical accounts.

How real exports behave:
- Leading digits are account codes, not meaning. "1100 Accounts Receivable" is receivables.
- QuickBooks prints a detail line AND a section total ("Accounts Receivable (A/R)" then
  "Total for Accounts Receivable"). The section total is the authoritative figure.
- A chart with a single bank account often prints no "Total Bank Accounts" line at all, so
  the detail row ("Cash in Bank", "Operating Account", "Checking") is the only place the
  cash figure appears. Map it.
- Contra accounts reduce their parent. "Accumulated Depreciation" is not an asset to map
  as one; "Net Computer Equipment" is already net of it.

Rules that protect the figures:
- NEVER map a subtotal that aggregates rows you are also mapping — that double-counts.
  "Total Current Assets", "Total Other Current Assets", "Total Liabilities and Equity"
  are subtotals. Skip them.
- Work in progress / work in process is inventory, not receivables, even though both sit
  in current assets. If there is no canonical inventory account, skip it.
- Retained earnings, owner's equity and common stock are components of equity. Map to the
  equity account only when no more specific one exists, and never alongside a total equity
  line.
- Prepaid expenses, deposits and intangibles are not cash and not receivables. Skip unless
  an exact canonical account exists.
- When two canonical accounts could plausibly fit, skip rather than guess. An unmapped row
  costs one click; a wrongly mapped row silently corrupts a client's statements.`;

export interface SuggestCandidate {
  id: string;
  label: string;
  statement: string;
}

export interface SuggestInput {
  /** Raw labels the deterministic resolver could not place. */
  labels: string[];
  /** The canonical accounts a label may be mapped to. */
  candidates: SuggestCandidate[];
  /** Which report the labels came from, so the model knows the context. */
  reportType: string;
  /** Domain instructions. Defaults to ACCOUNTING_GUIDANCE; override to retune at runtime. */
  guidance?: string;
}

export interface Suggestion {
  rawLabel: string;
  /** A canonical account id, or null meaning "no sensible mapping — skip". */
  accountId: string | null;
  reason: string;
}

/** Runner contract shared with classification: a prompt in, raw model text out. */
export type ModelRunner = (prompt: string) => Promise<string>;

export function buildSuggestPrompt(input: SuggestInput): string {
  const accounts = input.candidates
    .filter((c) => c.statement === input.reportType || input.reportType === "")
    .map((c) => `  ${c.id} = ${c.label}`)
    .join("\n");

  return [
    input.guidance ?? ACCOUNTING_GUIDANCE,
    "",
    `Report type: ${input.reportType}`,
    "",
    "Allowed account ids (you may use no others):",
    accounts || input.candidates.map((c) => `  ${c.id} = ${c.label}`).join("\n"),
    "",
    "Rows to map:",
    ...input.labels.map((l, i) => `${i + 1}. ${l}`),
    "",
    "Reply with one line per row, in order, in exactly this form:",
    "<row number>|<account id or skip>|<short reason, max 8 words>",
    "Output nothing else.",
  ].join("\n");
}

/**
 * Parse the model's reply.
 *
 * Tolerant by design: an unparseable or out-of-range line becomes "no suggestion" rather
 * than an error, because a partially useful answer is still worth showing and a model
 * that drifts from the format must not break the import.
 */
export function parseSuggestions(
  raw: string,
  input: SuggestInput,
): Suggestion[] {
  const valid = new Set(input.candidates.map((c) => c.id));
  const byIndex = new Map<number, Suggestion>();

  for (const line of raw.split("\n")) {
    const text = line.trim();
    if (text === "") continue;

    const parts = text.split("|").map((p) => p.trim());
    if (parts.length < 2) continue;

    const index = Number.parseInt(parts[0]!.replace(/\D/g, ""), 10);
    if (!Number.isFinite(index) || index < 1 || index > input.labels.length) continue;

    const answer = (parts[1] ?? "").toLowerCase();
    const reason = parts[2] ?? "";

    // Anything not in the canonical set — including "skip" and any hallucinated id —
    // resolves to null, which the UI renders as "Skip".
    const accountId = valid.has(parts[1]!) ? parts[1]! : answer === "skip" ? null : null;

    byIndex.set(index, {
      rawLabel: input.labels[index - 1]!,
      accountId,
      reason: reason.slice(0, 60),
    });
  }

  return input.labels.map(
    (rawLabel, i) =>
      byIndex.get(i + 1) ?? { rawLabel, accountId: null, reason: "" },
  );
}

/** Ask a model to map the labels the deterministic resolver could not place. */
export async function suggestMappings(
  input: SuggestInput,
  runner: ModelRunner,
): Promise<Suggestion[]> {
  if (input.labels.length === 0) return [];
  const raw = await runner(buildSuggestPrompt(input));
  return parseSuggestions(raw, input);
}
