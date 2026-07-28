// Workbook → Grid.
//
// SheetJS parses Excel structurally rather than visually, which is why the v9 session
// concluded that Excel import is materially more reliable than asking a model to read a
// PDF. That conclusion is kept; what changes is that the structural result now feeds a
// correctable mapping layer instead of a fixed regex.

import * as XLSX from "xlsx";
import type { Grid } from "./types.js";

export interface SheetGrid {
  name: string;
  grid: Grid;
}

/** Read every sheet of a workbook buffer into grids, preserving blank cells. */
export function readWorkbook(data: ArrayBuffer | Uint8Array): SheetGrid[] {
  const workbook = XLSX.read(data, { type: "array", cellDates: false });
  return workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    if (!sheet) return { name, grid: [] as Grid };
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      blankrows: true,
      defval: null,
      raw: true,
    });
    const grid: Grid = rows.map((row) =>
      (row as unknown[]).map((cell) =>
        cell === null || cell === undefined
          ? null
          : typeof cell === "number"
            ? cell
            : String(cell),
      ),
    );
    return { name, grid };
  });
}

/** The sheet with the most populated cells — QuickBooks exports sometimes add blanks. */
export function primarySheet(sheets: SheetGrid[]): Grid {
  let best: Grid = [];
  let bestCount = -1;
  for (const sheet of sheets) {
    let count = 0;
    for (const row of sheet.grid) {
      for (const cell of row) {
        if (cell !== null && String(cell).trim() !== "") count += 1;
      }
    }
    if (count > bestCount) {
      bestCount = count;
      best = sheet.grid;
    }
  }
  return best;
}

/** Parse CSV text into a grid. */
export function readCsv(text: string): Grid {
  const workbook = XLSX.read(text, { type: "string" });
  return primarySheet(
    workbook.SheetNames.map((name) => {
      const sheet = workbook.Sheets[name];
      const rows = sheet
        ? XLSX.utils.sheet_to_json<unknown[]>(sheet, {
            header: 1,
            blankrows: true,
            defval: null,
            raw: true,
          })
        : [];
      return {
        name,
        grid: rows.map((row) =>
          (row as unknown[]).map((cell) =>
            cell === null || cell === undefined
              ? null
              : typeof cell === "number"
                ? cell
                : String(cell),
          ),
        ),
      };
    }),
  );
}
