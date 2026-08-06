/**
 * Parsing the model's summary reply — pinned against what the model ACTUALLY sent.
 *
 * Both fixtures below are trimmed from a real llama-3.3-70b reply captured on the first run
 * of this feature against live data. Neither was hypothetical: together they discarded a
 * completely faithful summary and told the advisor their books were missing figures.
 */
import { describe, expect, it } from "vitest";
import { summaryPlainText, type SummaryLinkRegistry } from "@avilo/core";
import { parseSummaryOutput, salvageSummaryText } from "../src/services/configuration.js";

const registry: SummaryLinkRegistry = {
  reportSections: new Set(["service-lines", "top-expenses", "profitability"]),
  dashboardPanels: new Set(["cash", "warnings"]),
  viewIds: new Set(),
};

/** One object per paragraph — the model's habit, and not valid JSON when concatenated. */
const TWO_OBJECTS = `{"mode":"paragraph","blocks":[[{"text":"Revenue was "},{"text":"$204K","color":"#15803d"}]]}
{"mode":"paragraph","blocks":[[{"text":"Driven by "},{"text":"Restoration","link":"report:service-lines"}]]}`;

/** The same reply with the malformation the model also produced: `"text=` for `"text":`. */
const MALFORMED = `{"mode":"paragraph","blocks":[[{"text":"Operating income was "},{"text":"$43K","color":"#15803d"},{"text=", a margin of "},{"text":"21.2%","color":"#15803d"}]]}`;

describe("parseSummaryOutput", () => {
  it("merges several top-level objects into one document", () => {
    const doc = parseSummaryOutput(TWO_OBJECTS, registry);
    expect(doc).not.toBeNull();
    expect(doc!.blocks).toHaveLength(2);
    expect(summaryPlainText(doc!)).toContain("$204K");
    expect(summaryPlainText(doc!)).toContain("Restoration");
  });

  it("still reads a single object, fenced or bare", () => {
    const bare = '{"mode":"bullets","blocks":[[{"text":"One point."}]]}';
    expect(parseSummaryOutput(bare, registry)!.mode).toBe("bullets");
    expect(parseSummaryOutput("```json\n" + bare + "\n```", registry)!.mode).toBe("bullets");
  });

  it("does not mistake a brace inside a string for structure", () => {
    const doc = parseSummaryOutput('{"mode":"paragraph","blocks":[[{"text":"a } brace"}]]}', registry);
    expect(summaryPlainText(doc!)).toBe("a } brace");
  });

  it("returns null when there is nothing parseable", () => {
    expect(parseSummaryOutput("Just some prose.", registry)).toBeNull();
    expect(parseSummaryOutput("{ not json at all", registry)).toBeNull();
  });

  /*
    The `"text=` malformation, repaired. Each occurrence used to cost the entire rich
    summary — colour and links replaced by salvaged plain text — and a prompt instruction
    did not stop the model producing it.
  */
  it("repairs a quoted key followed by = instead of a colon", () => {
    const doc = parseSummaryOutput(MALFORMED, registry);
    expect(doc).not.toBeNull();
    expect(summaryPlainText(doc!)).toBe("Operating income was $43K, a margin of 21.2%");
    expect(doc!.blocks[0]!.some((s) => "color" in s)).toBe(true);
  });

  /*
    The repair must never touch a legitimate value. Anchoring it to a key position is the
    whole reason it is safe: unanchored, this rewrites `"a=` inside the string and destroys
    it.
  */
  it("leaves an = inside a string value alone", () => {
    const doc = parseSummaryOutput(
      '{"mode":"paragraph","blocks":[[{"text":"ratio a=b holds"}]]}',
      registry,
    );
    expect(summaryPlainText(doc!)).toBe("ratio a=b holds");
  });
});

describe("salvageSummaryText", () => {
  /*
    THE bug. Raw JSON went to `fabricatedFigures`, which read the hex colour #15803d as the
    number 15803 and rejected the summary for containing figures "not in your books". The
    check was correct; it was being shown JSON instead of prose.
  */
  it("never lets a colour code reach the figure check", () => {
    const text = salvageSummaryText(MALFORMED);
    expect(text).not.toContain("15803");
    expect(text).not.toContain("#");
    expect(text).toContain("$43K");
    expect(text).toContain("21.2%");
  });

  /*
    Salvage recovers the well-formed runs and loses the broken one — `{"text=", a margin of "}`
    has no recoverable key, so that connective phrase is gone. That is the honest limit: this
    is a rescue path, not a JSON repair tool. What matters is that every FIGURE survives, so
    the fabrication check sees the same numbers the advisor does, and that the reply is
    readable rather than raw JSON. A prettier salvage would mean guessing at the model's
    intent, which is how a summary ends up saying something nobody wrote.
  */
  it("recovers the well-formed runs, and does not invent the broken one", () => {
    const text = salvageSummaryText(MALFORMED);
    expect(text).toBe("Operating income was $43K21.2%");
    expect(text).not.toContain("a margin of");
  });

  it("leaves ordinary prose exactly as it is", () => {
    const prose = "Revenue was $204K, up 5.2% on the month before.";
    expect(salvageSummaryText(prose)).toBe(prose);
  });

  it("keeps every figure the advisor would see, so the check still bites", () => {
    // A fabricated figure inside a span must still be visible to fabricatedFigures.
    const invented = '{"blocks":[[{"text":"Revenue was $999K"}]]}';
    expect(salvageSummaryText(invented)).toContain("$999K");
  });
});
