// Deterministic file classification.
//
// The v9 build asked a cloud model to look at a PDF and guess. That was the wrong tool:
// classification of six known report types is a signature-matching problem with a stable
// answer, and it must work with the network switched off.
//
// Scoring is transparent by design — every decision carries the evidence that produced
// it, so when the classifier is wrong the user can see why and correct it in one click,
// and the correction is persisted.

import { cellText, rowLabel } from "./cells.js";
import { parsePeriodHeader } from "../periods.js";
import {
  REPORT_TYPES,
  type Classification,
  type ClassificationCandidate,
  type Grid,
  type ReportType,
} from "./types.js";

interface Signature {
  reportType: ReportType;
  /** Phrases in the document head. Weighted heavily: QuickBooks titles its reports. */
  titles: RegExp[];
  /** Row labels characteristic of the report body. */
  markers: RegExp[];
  /** Column headers characteristic of the report. */
  headers: RegExp[];
  /** Filename fragments. Weak evidence — users rename files. */
  filenames: RegExp[];
}

const SIGNATURES: Signature[] = [
  {
    reportType: "profit_and_loss",
    titles: [/profit\s*(and|&)?\s*loss/i, /income statement/i, /\bp\s*&\s*l\b/i],
    markers: [
      /^total for income$/i,
      /^total income$/i,
      /^cost of goods sold$/i,
      /^gross profit$/i,
      /^net operating income$/i,
      /^net income$/i,
    ],
    headers: [],
    filenames: [/profit/i, /\bp_?and_?l\b/i, /\bpnl\b/i, /income[_ -]?statement/i],
  },
  {
    reportType: "balance_sheet",
    titles: [/balance sheet/i, /statement of financial position/i],
    markers: [
      /^total assets$/i,
      /^total for assets$/i,
      /^total liabilities/i,
      /^bank accounts$/i,
      /^total equity$/i,
      /^accounts receivable/i,
    ],
    headers: [],
    filenames: [/balance/i, /\bbs\b/i],
  },
  {
    reportType: "ar_aging",
    titles: [/a\/?r\s*(ageing|aging)/i, /accounts receivable\s*(ageing|aging)/i],
    markers: [/^total$/i],
    headers: [/^current$/i, /^1\s*-\s*30$/i, /^31\s*-\s*60$/i, /^61\s*-\s*90$/i, /91 and over/i, /^\d+\s*-\s*\d+$/],
    filenames: [/a_?r.*(ageing|aging)/i, /(ageing|aging).*a_?r/i, /receivable/i],
  },
  {
    reportType: "ap_aging",
    titles: [/a\/?p\s*(ageing|aging)/i, /accounts payable\s*(ageing|aging)/i],
    markers: [/^total$/i],
    headers: [/^current$/i, /^1\s*-\s*30$/i, /^31\s*-\s*60$/i, /^61\s*-\s*90$/i, /91 and over/i],
    filenames: [/a_?p.*(ageing|aging)/i, /(ageing|aging).*a_?p/i, /payable/i],
  },
  {
    reportType: "referral_l90d",
    titles: [/referr(al|er)/i, /lead source/i],
    markers: [/referr(al|er)/i, /^source$/i],
    headers: [/referr(al|er)/i, /^source$/i, /lead source/i],
    filenames: [/referr/i, /l90/i, /lead[_ -]?source/i],
  },
  {
    reportType: "sales_by_customer_l12m",
    titles: [/sales by customer/i, /income by customer/i, /customer summary/i],
    markers: [/^total$/i],
    headers: [/^amount$/i, /^total$/i, /^customer$/i],
    filenames: [/sales[_ -]?by[_ -]?customer/i, /l12/i, /customer[_ -]?summary/i],
  },
];

/** How many leading rows count as the document "head" for title matching. */
const HEAD_ROWS = 8;
/** How many rows to scan for body markers. */
const BODY_ROWS = 200;

function scoreSignature(
  signature: Signature,
  head: string[],
  labels: string[],
  headers: string[],
  filename: string,
): ClassificationCandidate {
  const evidence: string[] = [];
  let score = 0;

  for (const pattern of signature.titles) {
    const hit = head.find((line) => pattern.test(line));
    if (hit) {
      score += 6;
      evidence.push(`title "${hit}"`);
      break;
    }
  }

  let markerHits = 0;
  for (const pattern of signature.markers) {
    const hit = labels.find((label) => pattern.test(label));
    if (hit) {
      markerHits += 1;
      if (evidence.length < 6) evidence.push(`row "${hit}"`);
    }
  }
  score += Math.min(markerHits, 4) * 2;

  let headerHits = 0;
  for (const pattern of signature.headers) {
    const hit = headers.find((header) => pattern.test(header));
    if (hit) {
      headerHits += 1;
      if (evidence.length < 8) evidence.push(`column "${hit}"`);
    }
  }
  score += Math.min(headerHits, 4) * 2;

  for (const pattern of signature.filenames) {
    if (pattern.test(filename)) {
      score += 2;
      evidence.push(`filename "${filename}"`);
      break;
    }
  }

  return { reportType: signature.reportType, score, evidence };
}

export interface ClassifyInput {
  filename: string;
  grid: Grid;
}

/**
 * A combined QuickBooks group export contains several reports in one document. It is
 * detected by finding titles for three or more distinct report types.
 */
function detectCombined(head: string[], allText: string[]): number {
  const distinct = new Set<ReportType>();
  for (const signature of SIGNATURES) {
    if (signature.titles.some((p) => allText.some((line) => p.test(line)))) {
      distinct.add(signature.reportType);
    }
  }
  void head;
  return distinct.size >= 3 ? distinct.size : 0;
}

export function classifyGrid(input: ClassifyInput): Classification {
  const { grid, filename } = input;

  const head = grid
    .slice(0, HEAD_ROWS)
    .map((row) => row.map(cellText).filter((t) => t !== "").join(" "))
    .filter((line) => line !== "");

  const body = grid.slice(0, BODY_ROWS);
  const labels = body.map(rowLabel).filter((label) => label !== "");

  // Header row candidates: any row containing a parsable period, or short text cells.
  const headers: string[] = [];
  for (const row of body.slice(0, 30)) {
    for (const cell of row) {
      const text = cellText(cell);
      if (text !== "" && text.length <= 24) headers.push(text);
    }
  }

  const allText = [...head, ...labels];

  const candidates = SIGNATURES.map((signature) =>
    scoreSignature(signature, head, labels, headers, filename),
  )
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);

  const combinedCount = detectCombined(head, allText);
  if (combinedCount > 0) {
    candidates.unshift({
      reportType: "combined_group_report",
      score: 6 + combinedCount * 2,
      evidence: [`${combinedCount} distinct report titles found in one document`],
    });
  }

  const best = candidates[0];
  if (!best || best.score < 4) {
    return {
      reportType: null,
      confidence: 0,
      method: "rules",
      evidence: best?.evidence ?? [],
      candidates,
      needsConfirmation: true,
    };
  }

  const runnerUp = candidates[1];
  const margin = best.score - (runnerUp?.score ?? 0);

  // Confidence blends absolute score with the margin over the next candidate. A file
  // that looks equally like two reports is never auto-imported, however high it scores.
  const absolute = Math.min(best.score / 14, 1);
  const separation = Math.min(margin / 6, 1);
  const confidence = Number((absolute * 0.6 + separation * 0.4).toFixed(3));

  return {
    reportType: best.reportType,
    confidence,
    method: "rules",
    evidence: best.evidence,
    candidates,
    needsConfirmation: confidence < 0.7,
  };
}

/**
 * Optional local-model fallback for files the rules cannot place.
 *
 * Deliberately an injected function rather than a hard dependency: the application must
 * run with no model installed and no network. When no runner is supplied, an unclassified
 * file simply asks the user, which is a fine outcome and costs one click.
 */
export type LocalModelRunner = (prompt: string) => Promise<string>;

export async function classifyWithFallback(
  input: ClassifyInput,
  runner?: LocalModelRunner,
): Promise<Classification> {
  const rules = classifyGrid(input);
  if (!rules.needsConfirmation || !runner) return rules;

  const preview = input.grid
    .slice(0, 25)
    .map((row) => row.map(cellText).filter((t) => t !== "").join(" | "))
    .filter((line) => line !== "")
    .join("\n");

  const prompt = [
    "Classify this accounting report. Answer with exactly one of these identifiers and nothing else:",
    REPORT_TYPES.join(", "),
    "",
    `Filename: ${input.filename}`,
    "First rows:",
    preview,
  ].join("\n");

  try {
    const answer = (await runner(prompt)).trim().toLowerCase();
    const matched = REPORT_TYPES.find((t) => answer.includes(t));
    if (!matched) return rules;
    return {
      reportType: matched,
      // A local model is a tie-breaker, never an authority: it always asks the user.
      confidence: 0.6,
      method: "local_llm",
      evidence: [...rules.evidence, "local model suggestion"],
      candidates: rules.candidates,
      needsConfirmation: true,
    };
  } catch {
    return rules;
  }
}
