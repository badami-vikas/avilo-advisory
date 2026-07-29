// PDF → Grid.
//
// The v9 session's conclusion still stands: a spreadsheet states its structure, and a
// PDF only draws one. Nothing here recovers information the export threw away. What it
// does is reconstruct the *geometry* deterministically — no model, no network, no guess
// about meaning — and then hand the result to the same parsers the Excel path uses.
//
// That boundary is the point. A PDF that reconstructs cleanly is parsed by exactly the
// code that parses Excel, so it inherits every fix made there. A PDF that does not
// reconstruct cleanly fails in the importer's existing review screen, where the user can
// see the recovered grid and correct it, rather than producing a confident wrong number.
//
// Scanned PDFs have no text layer at all. They are detected and refused rather than
// silently importing an empty report.

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { Cell, Grid } from "./types.js";

/**
 * pdfjs falls back to fetching the standard Type1 font metrics when a PDF references a
 * base-14 font without embedding it — which QuickBooks exports do. Pointing it at the
 * copy inside the installed package keeps that lookup on disk, so the importer still
 * works with the network switched off.
 */
const STANDARD_FONTS = (() => {
  try {
    const require = createRequire(import.meta.url);
    const root = dirname(require.resolve("pdfjs-dist/package.json"));
    return pathToFileURL(join(root, "standard_fonts") + "/").href;
  } catch {
    return undefined;
  }
})();

/** A positioned run of text recovered from a page. */
interface Piece {
  text: string;
  /** Left edge, in PDF points. */
  left: number;
  /** Right edge, in PDF points. */
  right: number;
  /** Baseline, in PDF points. Larger is higher up the page. */
  y: number;
}

/**
 * Two baselines within this many points are the same row. QuickBooks sets financial
 * reports at 8–10pt on ~12pt leading, and superscripts and footnote marks sit within a
 * couple of points of their line.
 */
const ROW_TOLERANCE = 3.5;

/**
 * Two column edges within this many points are the same column. Wider than the row
 * tolerance because numeric columns are right-aligned to a rule, but currency symbols
 * and parenthesised negatives shift the drawn extent slightly.
 */
const COLUMN_TOLERANCE = 8;

/** A row needs this many numeric cells before its x-positions define columns. */
const MIN_NUMERIC_FOR_ANCHOR = 1;

const NUMERIC = /^[(-]?\s*[$£€]?\s*-?[\d,]+(?:\.\d+)?\s*\)?%?$/;

function looksNumeric(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === "" || trimmed === "-" || trimmed === "—") return false;
  return NUMERIC.test(trimmed) && /\d/.test(trimmed);
}

/**
 * One-dimensional clustering over sorted positions. Positions within `tolerance` of the
 * running cluster join it; the cluster's anchor is the mean of its members, which keeps
 * a column anchored to where its numbers actually sit rather than to whichever one
 * happened to come first.
 */
function cluster(positions: number[], tolerance: number): number[] {
  if (positions.length === 0) return [];
  const sorted = [...positions].sort((a, b) => a - b);
  const anchors: number[] = [];
  let group: number[] = [sorted[0] as number];

  for (const position of sorted.slice(1)) {
    const last = group[group.length - 1] as number;
    if (position - last <= tolerance) {
      group.push(position);
    } else {
      anchors.push(group.reduce((sum, p) => sum + p, 0) / group.length);
      group = [position];
    }
  }
  anchors.push(group.reduce((sum, p) => sum + p, 0) / group.length);
  return anchors;
}

/** Group pieces into visual rows, top of page first. */
function toRows(pieces: Piece[]): Piece[][] {
  const byDescendingY = [...pieces].sort((a, b) => b.y - a.y);
  const rows: Piece[][] = [];

  for (const piece of byDescendingY) {
    const current = rows[rows.length - 1];
    if (current && Math.abs((current[0] as Piece).y - piece.y) <= ROW_TOLERANCE) {
      current.push(piece);
    } else {
      rows.push([piece]);
    }
  }

  for (const row of rows) row.sort((a, b) => a.left - b.left);
  return rows;
}

/**
 * Where the value columns start.
 *
 * Only rows that actually carry numbers get a vote, so a wide title or a wrapped note
 * cannot invent a column. Right edges are clustered rather than left edges because
 * financial columns are right-aligned: "1,234" and "987,654" share a right rule and
 * nothing else.
 */
function valueColumnAnchors(rows: Piece[][]): number[] {
  const rightEdges: number[] = [];
  for (const row of rows) {
    const numeric = row.filter((piece) => looksNumeric(piece.text));
    if (numeric.length >= MIN_NUMERIC_FOR_ANCHOR) {
      for (const piece of numeric) rightEdges.push(piece.right);
    }
  }
  return cluster(rightEdges, COLUMN_TOLERANCE);
}

function toCell(text: string): Cell {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  if (!looksNumeric(trimmed)) return trimmed;

  const negative = /^\(.*\)$/.test(trimmed);
  const digits = trimmed.replace(/[(),$£€%\s]/g, "");
  const value = Number(digits);
  if (!Number.isFinite(value)) return trimmed;
  return negative ? -value : value;
}

/**
 * Lay a page's rows onto the column anchors.
 *
 * Column 0 is the row label: everything drawn to the left of the first value column.
 * Every other piece is assigned to the nearest anchor. Numbers are matched on their
 * right edge, which is what the anchors were built from; header text such as "Oct 2024"
 * is matched on its centre, because a column heading is set over its column rather than
 * flush to the same rule.
 */
function layout(rows: Piece[][], anchors: number[]): Grid {
  if (anchors.length === 0) {
    return rows.map((row) => [row.map((piece) => piece.text).join(" ").trim() || null]);
  }

  const labelBoundary = (anchors[0] as number) - COLUMN_TOLERANCE * 2;
  const grid: Grid = [];

  for (const row of rows) {
    const labelParts: string[] = [];
    const columns: string[][] = anchors.map(() => []);

    for (const piece of row) {
      const numeric = looksNumeric(piece.text);
      if (!numeric && piece.right <= labelBoundary) {
        labelParts.push(piece.text);
        continue;
      }

      const probe = numeric ? piece.right : (piece.left + piece.right) / 2;
      let best = 0;
      let bestDistance = Infinity;
      for (let i = 0; i < anchors.length; i += 1) {
        const distance = Math.abs((anchors[i] as number) - probe);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = i;
        }
      }

      // A non-numeric piece that lands nowhere near a column is part of the label —
      // a long note running under the value columns, typically.
      if (!numeric && bestDistance > COLUMN_TOLERANCE * 4) {
        labelParts.push(piece.text);
        continue;
      }
      (columns[best] as string[]).push(piece.text);
    }

    const cells: Grid[number] = [toCell(labelParts.join(" "))];
    for (const parts of columns) cells.push(toCell(parts.join(" ")));

    if (cells.some((cell) => cell !== null)) grid.push(cells);
  }

  return grid;
}

export class ScannedPdfError extends Error {
  constructor(filename: string) {
    super(
      `${filename} has no text layer — it is a scan or an image. ` +
        `Export the report from QuickBooks as Excel or CSV instead.`,
    );
    this.name = "ScannedPdfError";
  }
}

export interface PdfGrid {
  grid: Grid;
  pageCount: number;
  warnings: string[];
}

/**
 * Reconstruct a PDF's tabular content.
 *
 * Pages are concatenated because QuickBooks paginates a single report and repeats its
 * column headers; the parsers already pick the header row by content rather than by
 * position, so a repeated header is inert rather than harmful.
 */
export async function readPdf(
  data: Uint8Array,
  filename = "document.pdf",
): Promise<PdfGrid> {
  const task = getDocument({
    // pdfjs transfers and neuters the buffer it is given, which would corrupt the copy
    // the caller still holds for hashing and storage.
    data: new Uint8Array(data),
    // No font files are fetched: only text positions are needed, never glyphs.
    disableFontFace: true,
    useSystemFonts: false,
    standardFontDataUrl: STANDARD_FONTS,
    // Errors only. pdfjs warns when it cannot load a substitution face for an
    // unembedded base-14 font, which every QuickBooks export triggers. Glyph shapes are
    // never needed here — positions come from the text matrix and advance widths from
    // pdfjs's built-in base-14 metrics — so the warning is noise, and left on it would
    // print once per font per file.
    verbosity: 0,
  });
  const document = await task.promise;
  const pageCount = document.numPages;

  const warnings: string[] = [];
  const grid: Grid = [];

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();

    const pieces: Piece[] = [];
    for (const item of content.items) {
      if (!("str" in item)) continue;
      const text = item.str;
      if (text.trim() === "") continue;
      const transform = item.transform as number[];
      const left = transform[4] as number;
      const width = typeof item.width === "number" ? item.width : 0;
      pieces.push({ text, left, right: left + width, y: transform[5] as number });
    }

    page.cleanup();
    if (pieces.length === 0) continue;

    const rows = toRows(pieces);
    const anchors = valueColumnAnchors(rows);
    if (anchors.length === 0) {
      warnings.push(`Page ${pageNumber} carried no numeric columns and was read as text.`);
    }
    grid.push(...layout(rows, anchors));
  }

  await task.destroy();

  if (grid.length === 0) throw new ScannedPdfError(filename);

  return { grid, pageCount, warnings };
}
