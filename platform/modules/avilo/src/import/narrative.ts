// AI-assisted narrative for the executive summary.
//
// The dashboard already writes a summary without any model: `insights.ts` assembles it
// from measured facts, which is why it is instant, works offline, and can never contradict
// the numbers beside it. That deterministic text is the source of truth and stays exactly
// as it is.
//
// What a model adds is register, not content. An advisor sending a month-end note to a
// client wants continuous prose rather than five labelled beats — and wants it in their own
// words, not the engine's. So this asks for a rewrite of facts the app has already
// computed, never for analysis.
//
// The distinction is the whole safety story: the model receives finished sentences and is
// forbidden from introducing a figure that is not among them. A model that cannot invent a
// number cannot invent a wrong one.

export interface NarrativeBeat {
  kicker: string;
  headline: string;
  body: string[];
}

export interface NarrativeInput {
  clientName: string;
  periodLabel: string;
  beats: NarrativeBeat[];
  /** House style for the summary. Overridable at runtime, like the mapping guidance. */
  guidance?: string;
}

export const NARRATIVE_GUIDANCE = `You are an accountant writing the opening of a month-end note to a client.

You will be given findings that have already been calculated from the client's own books.
Rewrite them as continuous prose the client can read in under a minute.

Absolute rules:
- Use ONLY the figures and facts given. Never introduce a number, percentage, date, ratio
  or trend that does not appear in the findings. If something is not stated, it is not known.
- Never soften or dramatise a finding. If margin fell, say it fell.
- Do not add advice, predictions, or causes that are not in the findings. You are rewriting,
  not analysing.

Style:
- Two or three short paragraphs. No headings, no bullet points, no bold.
- Plain business English. Address the reader as "you"; refer to the business by name once.
- Lead with what happened, then why, then what it means for the month ahead.
- Keep every figure exactly as written, including its units and sign.`;

/**
 * A stable identity for one computed summary.
 *
 * Two summaries fingerprint the same when they say the same thing, so an edit survives a
 * re-render, a restart and a recomputation from unchanged facts — and stops surviving the
 * moment a figure moves. Deliberately content-based rather than a timestamp: importing
 * the same file twice must not invalidate the advisor's wording.
 *
 * A non-cryptographic hash is the right tool: this detects change, it does not defend
 * against a forged match, and there is no adversary here.
 */
export function summaryFingerprint(beats: NarrativeBeat[]): string {
  const source = beats
    .map((beat) => `${beat.kicker}|${beat.headline}|${beat.body.join("|")}`)
    .join("||");

  // FNV-1a, 32-bit.
  let hash = 0x811c9dc5;
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function buildNarrativePrompt(input: NarrativeInput): string {
  const findings = input.beats
    .map((beat) => [`${beat.kicker}: ${beat.headline}`, ...beat.body.map((b) => `  - ${b}`)].join("\n"))
    .join("\n\n");

  return [
    input.guidance ?? NARRATIVE_GUIDANCE,
    "",
    `Client: ${input.clientName}`,
    `Period: ${input.periodLabel}`,
    "",
    "Findings (already calculated — these are your only source):",
    findings,
    "",
    "Write the note now. Output only the prose.",
  ].join("\n");
}

/**
 * Every number the findings contain.
 *
 * Used to check the model's output back against its source. Matches currency, percentages,
 * plain counts and negatives, so a fabricated figure has nowhere to hide.
 */
export function figuresIn(text: string): string[] {
  return (text.match(/-?[\d,]+(?:\.\d+)?%?/g) ?? [])
    .map((figure) => {
      // Normalise the number and the unit separately. Stripping trailing zeros with a
      // single end-anchored rule silently skipped every percentage, so "8.40%" and "8.4%"
      // compared unequal and a faithful rewrite was discarded as fabricated.
      const percent = figure.endsWith("%");
      const number = (percent ? figure.slice(0, -1) : figure)
        .replace(/,/g, "")
        // Trailing zeros in the fraction only: "8.40" -> "8.4", "31.0" -> "31.", then the
        // bare dot goes. An end-anchored /\.0+$/ matched only all-zero fractions, so
        // "8.40" was left as-is and compared unequal to "8.4".
        .replace(/(\.\d*?)0+$/, "$1")
        .replace(/\.$/, "");
      return percent ? `${number}%` : number;
    })
    .filter((figure) => figure !== "" && figure !== "-" && figure !== "%");
}

/**
 * Figures the model produced that were not in the findings.
 *
 * A non-empty result means the narrative asserts something the books do not support, and
 * the caller shows the deterministic summary instead. This is the guard that makes it
 * acceptable to put generated prose in front of a client at all.
 */
export function fabricatedFigures(source: string, generated: string): string[] {
  const allowed = new Set(figuresIn(source));
  // Small integers are ordinary prose ("three months", "the first two"), not claims.
  return figuresIn(generated).filter(
    (figure) => !allowed.has(figure) && !(Math.abs(Number(figure)) <= 12 && !figure.includes("%")),
  );
}
