// A minimal PDF writer, for tests only.
//
// The PDF importer's whole job is recovering a table from drawn positions, so testing it
// against a hand-built grid of coordinates would test nothing: the fixture would encode
// the same assumptions as the code. These fixtures are real PDFs, laid out the way
// QuickBooks lays one out — labels flush left, values flush right against a shared rule —
// and read back through pdfjs exactly as an uploaded file would be.

/** Helvetica advance widths, in 1/1000 em. Only the glyphs the fixtures use. */
const WIDTHS: Record<string, number> = {
  " ": 278, "!": 278, "$": 556, "%": 889, "(": 333, ")": 333, ",": 278,
  "-": 333, ".": 278, "/": 278, "&": 667, ":": 278, "'": 191,
  "0": 556, "1": 556, "2": 556, "3": 556, "4": 556, "5": 556,
  "6": 556, "7": 556, "8": 556, "9": 556,
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278,
  J: 500, K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722,
  S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222,
  j: 222, k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333,
  s: 500, t: 278, u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
};

export function textWidth(text: string, size: number): number {
  let total = 0;
  for (const character of text) total += WIDTHS[character] ?? 556;
  return (total / 1000) * size;
}

export interface PdfCell {
  text: string;
  /** For "left" this is the left edge; for "right" it is the right edge. */
  x: number;
  align?: "left" | "right";
}

export interface PdfRow {
  /** Baseline from the bottom of the page, in points. */
  y: number;
  cells: PdfCell[];
  size?: number;
}

function escapeText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/** Build a single-page PDF containing the given positioned text. */
export function makePdf(rows: PdfRow[]): Uint8Array {
  const operations: string[] = [];
  for (const row of rows) {
    const size = row.size ?? 9;
    for (const cell of row.cells) {
      const left =
        cell.align === "right" ? cell.x - textWidth(cell.text, size) : cell.x;
      operations.push(
        `BT /F1 ${size} Tf 1 0 0 1 ${left.toFixed(2)} ${row.y.toFixed(2)} Tm (${escapeText(cell.text)}) Tj ET`,
      );
    }
  }
  const stream = operations.join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] " +
      "/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return new Uint8Array(Buffer.from(pdf, "latin1"));
}

/** An empty page: a stand-in for a scan, which carries no text layer at all. */
export function makeEmptyPdf(): Uint8Array {
  return makePdf([]);
}
