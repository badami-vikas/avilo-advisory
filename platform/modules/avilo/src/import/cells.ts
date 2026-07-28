// Cell coercion.
//
// QuickBooks writes money in a surprising number of shapes and the prototype's
// `parseFloat` approach silently turned several of them into NaN or, worse, into a
// positive number where the report meant a negative one.

import type { Cell } from "./types.js";

export function cellText(cell: Cell): string {
  if (cell === null || cell === undefined) return "";
  return String(cell).trim();
}

export function isBlank(cell: Cell): boolean {
  return cellText(cell) === "";
}

/**
 * Parse a monetary or numeric cell.
 *
 * Handles: plain numbers, "$1,234.56", "1 234,56"-free US formatting, accounting
 * negatives "(1,234.00)", explicit "-1,234", a lone "-" or "—" meaning zero, trailing
 * percent signs, and Excel numeric cells that arrive already typed.
 *
 * Returns null for anything that is not a number, so a text row can never be mistaken
 * for a zero.
 */
export function parseNumber(cell: Cell): number | null {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === "number") return Number.isFinite(cell) ? cell : null;

  let text = String(cell).trim();
  if (text === "") return null;

  // QuickBooks renders a zero-value line as a bare dash.
  if (/^[-–—]$/.test(text)) return 0;

  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1).trim();
  }

  text = text.replace(/[$£€]/g, "").replace(/,/g, "").replace(/%$/, "").trim();

  if (text.startsWith("-")) {
    negative = !negative;
    text = text.slice(1).trim();
  }

  if (text === "") return null;
  if (!/^\d*\.?\d+$/.test(text)) return null;

  const value = Number(text);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

/** The first non-blank cell in a row, which is where QuickBooks puts the row label. */
export function rowLabel(row: Cell[]): string {
  for (const cell of row) {
    const text = cellText(cell);
    if (text !== "") return text;
  }
  return "";
}

/** Index of the first non-blank cell, used to infer indentation depth. */
export function labelColumn(row: Cell[]): number {
  for (let i = 0; i < row.length; i += 1) {
    if (!isBlank(row[i] ?? null)) return i;
  }
  return -1;
}
