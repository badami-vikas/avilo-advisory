// Rich text for the executive summary: colour and in-app links, without markup.
//
// The request this answers was "a single continuous paragraph, colour-coded text, and
// hyperlinks". The obvious implementation — let the model emit HTML and render it — would
// undo the property the rest of this codebase is built around: model output would become
// page content, and an <a href> in a client-facing PDF would be an outbound request from an
// application whose premise is that nothing leaves the machine without a button press.
//
// So the same move as ViewComponent (ADR-041): a closed grammar of *spans*. A span carries
// the model's words, optionally a colour, optionally the id of a place inside this app. It
// has no field for markup and no field for a URL. The renderer sets `style.color` through
// the CSSOM and resolves a link id against a registry — neither path can produce an element
// or a request the application did not already have.
//
// Colour is deliberately unrestricted (any hex or CSS colour function). It was never the
// risk: the worst a wrong colour does is look wrong, and the user can see that and say so.

/** One run of text. Exactly one of `color`/`link` may qualify it, or neither. */
export type SummarySpan =
  | { text: string }
  | { text: string; color: string }
  | { text: string; link: string };

export interface SummaryDoc {
  /** `paragraph` renders one continuous block; `bullets` renders a list. */
  mode: "paragraph" | "bullets";
  /** Each block is a paragraph or a bullet, depending on `mode`. */
  blocks: SummarySpan[][];
}

/**
 * Is this a colour, and only a colour?
 *
 * React assigns this to `style.color` through the CSSOM, which silently drops anything that
 * is not a valid colour — so this check is about keeping the stored document clean and
 * failing loudly on nonsense, not about preventing an injection the platform already makes
 * impossible. Hex, the CSS colour functions, and a bare colour keyword all pass.
 */
export function isColor(value: string): boolean {
  const v = value.trim();
  if (/^#[0-9a-f]{3,8}$/i.test(v)) return true;
  if (/^(rgb|rgba|hsl|hsla)\([\d.,%\s/-]+\)$/i.test(v)) return true;
  return /^[a-z]{3,20}$/i.test(v);
}

/**
 * Where a summary link may point.
 *
 * Every target names somewhere inside this installation. There is no form that can express
 * an external address, which is the whole point — a summary goes into a PDF that gets sent
 * to a client, and a link in that document must not be able to reach the network.
 */
export type LinkKind = "report" | "dashboard" | "view" | "raw";

export function parseLinkTarget(
  link: string,
): { kind: LinkKind; id: string } | null {
  if (link === "raw") return { kind: "raw", id: "" };
  const match = /^(report|dashboard|view):([a-z0-9][a-z0-9_-]*)$/i.exec(link);
  if (!match) return null;
  return { kind: match[1] as LinkKind, id: match[2]! };
}

export interface SummaryLinkRegistry {
  reportSections: ReadonlySet<string>;
  dashboardPanels: ReadonlySet<string>;
  viewIds: ReadonlySet<string>;
}

export interface SummaryError {
  path: string;
  message: string;
}

/**
 * Turn whatever the model produced into a `SummaryDoc`, or refuse it.
 *
 * Refuses whole rather than dropping bad spans: a summary with one link quietly removed
 * reads as complete and is not, and this text is what an advisor sends to their client.
 */
export function validateSummaryDoc(
  candidate: unknown,
  registry: SummaryLinkRegistry,
): { doc: SummaryDoc | null; errors: SummaryError[] } {
  const errors: SummaryError[] = [];
  const fail = (path: string, message: string) => errors.push({ path, message });

  if (typeof candidate !== "object" || candidate === null) {
    return { doc: null, errors: [{ path: "$", message: "Not a JSON object." }] };
  }
  const raw = candidate as Record<string, unknown>;
  const mode = raw.mode === "bullets" ? "bullets" : "paragraph";

  if (!Array.isArray(raw.blocks)) {
    return { doc: null, errors: [{ path: "blocks", message: "Not an array." }] };
  }

  const blocks: SummarySpan[][] = [];
  raw.blocks.forEach((rawBlock, i) => {
    if (!Array.isArray(rawBlock)) return fail(`blocks[${i}]`, "Not an array of spans.");
    const spans: SummarySpan[] = [];

    rawBlock.forEach((rawSpan, j) => {
      const at = `blocks[${i}][${j}]`;
      // A bare string is a plain run — the shape a model reaches for most often.
      const s = (typeof rawSpan === "string" ? { text: rawSpan } : rawSpan) as Record<string, unknown>;
      if (typeof s !== "object" || s === null) return fail(at, "Not a span.");
      if (typeof s.text !== "string" || s.text === "") return fail(`${at}.text`, "Missing text.");

      if (typeof s.link === "string") {
        const target = parseLinkTarget(s.link);
        if (!target) return fail(`${at}.link`, `"${s.link}" is not an in-app destination.`);
        const known =
          target.kind === "raw" ||
          (target.kind === "report" && registry.reportSections.has(target.id)) ||
          (target.kind === "dashboard" && registry.dashboardPanels.has(target.id)) ||
          (target.kind === "view" && registry.viewIds.has(target.id));
        if (!known) return fail(`${at}.link`, `Nothing here is called "${s.link}".`);
        spans.push({ text: s.text, link: s.link });
        return;
      }

      if (typeof s.color === "string") {
        if (!isColor(s.color)) return fail(`${at}.color`, `"${s.color}" is not a colour.`);
        spans.push({ text: s.text, color: s.color });
        return;
      }

      spans.push({ text: s.text });
    });

    if (spans.length > 0) blocks.push(spans);
  });

  if (blocks.length === 0) fail("blocks", "The summary is empty.");
  if (errors.length > 0) return { doc: null, errors };
  return { doc: { mode, blocks }, errors: [] };
}

/**
 * The document as plain text.
 *
 * Two callers, and the first is the important one: `fabricatedFigures` checks the model's
 * output back against the findings it was given, and it must see every word — a figure
 * hidden inside a coloured span is still a figure the books may not contain. Splitting
 * prose into spans must not create a gap in that check.
 */
export function summaryPlainText(doc: SummaryDoc): string {
  return doc.blocks.map((block) => block.map((span) => span.text).join("")).join("\n\n");
}
