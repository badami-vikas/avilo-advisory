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
 * House style for the Key Insights draft — the advisor's own commentary field, not the
 * client-facing executive summary. Deliberately shorter and plainer: two or three sentences
 * an advisor would jot down themselves, not client-ready prose. Reuses the same
 * findings-only, no-invented-figures contract as `NARRATIVE_GUIDANCE` — that contract is
 * what makes offering a draft here safe at all, not a relaxed version of it.
 */
export const KEY_INSIGHTS_GUIDANCE = `You are an accountant jotting a short internal note to
yourself about this client's month, using findings that have already been calculated from
their books.

Absolute rules:
- Use ONLY the figures and facts given. Never introduce a number, percentage, date, ratio
  or trend that does not appear in the findings. If something is not stated, it is not known.
- Never soften or dramatise a finding. If margin fell, say it fell.
- Do not add advice, predictions, or causes that are not in the findings. You are rewriting,
  not analysing.

Style:
- Two or three short sentences. No headings, no bullet points, no bold, one paragraph.
- Plain, direct, and terse — the tone of a note to yourself, not a message to the client.
- Lead with the single most important thing this month, then one supporting fact.
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
 * The same prompt, asking for a `SummaryDoc` instead of loose prose.
 *
 * Separate from `buildNarrativePrompt` rather than replacing it: the plain-prose path is
 * what runs when the model returns something unparseable, and keeping both means a rich
 * summary is an upgrade rather than a new way for Generate to fail.
 *
 * `destinations` is the closed list of places a link may point. It is composed by the
 * caller from the live registry, so the model is choosing from what this installation
 * actually has — the same "a model may choose, never invent" rule the rest of the app runs
 * on, applied to a hyperlink.
 */
export function buildRichNarrativePrompt(
  input: NarrativeInput & { destinations: string[] },
): string {
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
    "Return ONLY a JSON object, no prose around it, in this shape:",
    '{"mode":"paragraph","blocks":[[{"text":"Revenue held at "},{"text":"$204K","color":"#15803d"},',
    '{"text":" — see "},{"text":"the profitability section","link":"report:profitability"},{"text":"."}]]}',
    "",
    'A block is one paragraph (mode "paragraph") or one bullet (mode "bullets"). A span is',
    "either plain text, text with a `color`, or text with a `link`. Use whatever colours you",
    "think communicate best — any hex value or CSS colour name. Green for what improved, red",
    "for what worsened, is the convention here, but it is your call.",
    "",
    "A `link` must be one of these exact destinations, and nothing else:",
    input.destinations.join(", "),
    "",
    // Observed on the first run under a house style that asked for links: the model used the
    // destination id as the visible words, printing "report:cash-position" mid-sentence in a
    // paragraph destined for a client PDF.
    "`text` is what the READER sees and `link` is where it goes. They are never the same.",
    'Write the words a client would read — {"text":"cash position","link":"report:cash-position"},',
    'never {"text":"report:cash-position","link":"report:cash-position"}. A destination id must',
    "not appear in the prose.",
    "",
    "There is no way to link outside the application, and no way to emit HTML. Do not try;",
    "a document containing either is discarded whole and the advisor sees nothing.",
    "Every figure must come from the findings above.",
    "",
    // Both of these were observed on the first real run and cost the whole rich summary.
    "Return exactly ONE object containing every block. Do not emit one object per paragraph.",
    'Use strict JSON: every key quoted and followed by a colon — {"text": "..."}, never {"text= ...}.',
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
