/**
 * The executive-summary rich-text grammar.
 *
 * What these pin is not "colour works" — it is that the two things deliberately left out
 * cannot be smuggled back in. A summary goes into a PDF an advisor sends to their client,
 * so a span that could carry raw markup or an external address would be an outbound request
 * from an offline-first application. Neither is refused by a filter that could be bypassed;
 * there is no field for either, and a link is an id resolved against a registry.
 */
import { describe, expect, it } from "vitest";
import {
  isColor,
  parseLinkTarget,
  summaryPlainText,
  validateSummaryDoc,
  type SummaryLinkRegistry,
} from "../src/summary.js";

const registry: SummaryLinkRegistry = {
  reportSections: new Set(["profitability", "cash-position"]),
  dashboardPanels: new Set(["warnings", "cash"]),
  viewIds: new Set(["overdue-invoices"]),
};

const doc = (blocks: unknown) => ({ mode: "paragraph", blocks });

describe("colours", () => {
  it("accepts the forms a model actually reaches for", () => {
    for (const c of ["#0a0", "#15803d", "#15803dff", "rgb(21, 128, 61)", "hsl(140 60% 30%)", "crimson"]) {
      expect(isColor(c)).toBe(true);
    }
  });

  it("refuses something that is not a colour", () => {
    for (const c of ["url(http://evil.test/x.png)", "red; background: url(x)", "expression(1)", ""]) {
      expect(isColor(c)).toBe(false);
    }
  });
});

describe("links", () => {
  it("parses the in-app destinations", () => {
    expect(parseLinkTarget("report:profitability")).toEqual({ kind: "report", id: "profitability" });
    expect(parseLinkTarget("view:overdue-invoices")).toEqual({ kind: "view", id: "overdue-invoices" });
    expect(parseLinkTarget("raw")).toEqual({ kind: "raw", id: "" });
  });

  /* The property the whole design rests on: there is no external form to parse. */
  it("cannot express an address outside the application", () => {
    for (const link of [
      "https://evil.test",
      "http://localhost:9/x",
      "//evil.test",
      "javascript:alert(1)",
      "data:text/html,<script>",
      "mailto:a@b.c",
      "report:../../etc/passwd",
    ]) {
      expect(parseLinkTarget(link)).toBeNull();
    }
  });

  it("refuses a destination this installation does not have", () => {
    const { doc: out, errors } = validateSummaryDoc(
      doc([[{ text: "see this", link: "view:not-a-real-view" }]]),
      registry,
    );
    expect(out).toBeNull();
    expect(errors[0]?.message).toContain("not-a-real-view");
  });
});

describe("validateSummaryDoc", () => {
  it("accepts plain, coloured and linked spans together", () => {
    const { doc: out, errors } = validateSummaryDoc(
      doc([
        [
          { text: "Revenue held at " },
          { text: "$204K", color: "#15803d" },
          { text: " — see " },
          { text: "profitability", link: "report:profitability" },
        ],
      ]),
      registry,
    );
    expect(errors).toEqual([]);
    expect(out?.blocks[0]).toHaveLength(4);
    expect(out?.mode).toBe("paragraph");
  });

  it("takes a bare string as a plain run", () => {
    const { doc: out } = validateSummaryDoc(doc([["just words"]]), registry);
    expect(out?.blocks[0]?.[0]).toEqual({ text: "just words" });
  });

  it("keeps bullets when asked for bullets, paragraph otherwise", () => {
    expect(validateSummaryDoc({ mode: "bullets", blocks: [["a"]] }, registry).doc?.mode).toBe("bullets");
    expect(validateSummaryDoc({ mode: "nonsense", blocks: [["a"]] }, registry).doc?.mode).toBe("paragraph");
  });

  /*
    Refuse whole, never partially. A summary with one link silently dropped still reads as
    finished — and this is the text an advisor sends to a client.
  */
  it("refuses the document when one span is bad, rather than dropping that span", () => {
    const { doc: out } = validateSummaryDoc(
      doc([[{ text: "fine" }, { text: "bad", link: "https://evil.test" }]]),
      registry,
    );
    expect(out).toBeNull();
  });

  it("has no field for markup — an html key is simply not carried through", () => {
    const { doc: out } = validateSummaryDoc(
      doc([[{ text: "hello", html: "<script>alert(1)</script>", href: "https://evil.test" }]]),
      registry,
    );
    expect(out?.blocks[0]?.[0]).toEqual({ text: "hello" });
    expect(JSON.stringify(out)).not.toContain("script");
    expect(JSON.stringify(out)).not.toContain("evil.test");
  });

  it("rejects an empty document rather than rendering a blank summary", () => {
    expect(validateSummaryDoc(doc([]), registry).doc).toBeNull();
    expect(validateSummaryDoc("not json", registry).doc).toBeNull();
  });
});

describe("summaryPlainText", () => {
  /*
    The fabricated-figure check reads this. A figure hidden inside a coloured span is still
    a figure the books may not contain, so splitting prose into spans must not create a gap
    in the one guarantee that matters most.
  */
  it("includes every span's words, coloured and linked ones included", () => {
    const { doc: out } = validateSummaryDoc(
      doc([
        [{ text: "Cash is " }, { text: "$85K", color: "red" }, { text: " and DSO is " }, { text: "9 days", link: "raw" }],
        [{ text: "Second block." }],
      ]),
      registry,
    );
    const text = summaryPlainText(out!);
    expect(text).toContain("$85K");
    expect(text).toContain("9 days");
    expect(text).toContain("Second block.");
  });
});
