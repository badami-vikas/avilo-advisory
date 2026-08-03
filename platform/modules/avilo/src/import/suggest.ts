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
    "You map bookkeeping row labels onto a fixed chart of accounts.",
    "",
    `Report type: ${input.reportType}`,
    "",
    "Allowed account ids (you may use no others):",
    accounts || input.candidates.map((c) => `  ${c.id} = ${c.label}`).join("\n"),
    "",
    "Rules:",
    '- Answer "skip" when the row is a SUBTOTAL of other rows (e.g. "Total Current Assets"),',
    "  because mapping a subtotal alongside its children double-counts the figure.",
    '- Answer "skip" when no allowed account is a genuine match. Do not force a mapping.',
    "- Ignore any leading account-code digits when judging the meaning of a label.",
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
