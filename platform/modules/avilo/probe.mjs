/**
 * Throwaway diagnostic: measure the geometry of a generated PDF.
 *
 * Lives inside the module package only so it can resolve pdfjs-dist. Delete after use.
 */
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const fs = await import("node:fs/promises");

const data = new Uint8Array(await fs.readFile(process.argv[2]));
const task = pdfjs.getDocument({ data, verbosity: 0 });
const doc = await task.promise;

console.log("PAGES:", doc.numPages);
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p);
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();

  let minX = 1e9;
  let maxX = -1e9;
  let minY = 1e9;
  let maxY = -1e9;
  const lines = [];
  for (const it of tc.items) {
    if (!it.str.trim()) continue;
    const x = it.transform[4];
    const y = it.transform[5];
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x + (it.width || 0));
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    lines.push({ y: Math.round(y), x: Math.round(x), s: it.str });
  }

  console.log(`\n--- PAGE ${p}  ${Math.round(vp.width)}x${Math.round(vp.height)}pt`);
  if (lines.length === 0) {
    console.log("    (no text)");
    continue;
  }
  console.log(
    `    margins  left=${Math.round(minX)} right=${Math.round(vp.width - maxX)} top=${Math.round(vp.height - maxY)} bottom=${Math.round(minY)}`,
  );
  const top = lines
    .sort((a, b) => b.y - a.y)
    .slice(0, 3)
    .map((l) => `"${l.s}"@x${l.x}`);
  console.log("    top text:", top.join(" | ").slice(0, 160));
}

await task.destroy();
