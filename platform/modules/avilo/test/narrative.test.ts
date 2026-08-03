import { describe, expect, it } from "vitest";

import {
  buildNarrativePrompt,
  fabricatedFigures,
  figuresIn,
  summaryFingerprint,
} from "../src/import/narrative.js";

const input = {
  clientName: "Acme Construction",
  periodLabel: "October 2024",
  beats: [
    {
      kicker: "What happened",
      headline: "A bigger month",
      body: ["Revenue was $482,000, up 8.4% on September."],
    },
    {
      kicker: "Why",
      headline: "Margin held",
      body: ["Gross margin was 31.2%, down 0.4 points."],
    },
  ],
};

describe("buildNarrativePrompt", () => {
  it("carries the findings as the model's only source", () => {
    const prompt = buildNarrativePrompt(input);
    expect(prompt).toContain("Revenue was $482,000, up 8.4% on September.");
    expect(prompt).toContain("Gross margin was 31.2%");
    expect(prompt).toContain("Acme Construction");
    expect(prompt).toContain("October 2024");
  });

  it("forbids introducing figures that are not in the findings", () => {
    expect(buildNarrativePrompt(input)).toMatch(/never introduce a number/i);
  });

  it("uses supplied guidance in place of the default", () => {
    const prompt = buildNarrativePrompt({ ...input, guidance: "HOUSE STYLE" });
    expect(prompt).toContain("HOUSE STYLE");
    expect(prompt).not.toMatch(/month-end note to a client/);
  });
});

describe("figuresIn", () => {
  it("finds currency, percentages and plain numbers", () => {
    expect(figuresIn("Revenue was $482,000, up 8.4%")).toEqual(["482000", "8.4%"]);
  });

  it("normalises thousands separators and trailing zeros", () => {
    expect(figuresIn("1,234.00")).toEqual(["1234"]);
  });
});

/**
 * The guard that makes generated prose safe to put in front of a client: anything the
 * model asserts must trace back to a figure the books produced.
 */
describe("fabricatedFigures", () => {
  const source = "Revenue was $482,000, up 8.4% on September. Gross margin was 31.2%.";

  it("passes a rewrite that reuses only the source figures", () => {
    const generated =
      "Revenue reached $482,000 in the month, an increase of 8.4%. Gross margin stood at 31.2%.";
    expect(fabricatedFigures(source, generated)).toEqual([]);
  });

  it("catches an invented figure", () => {
    const generated = "Revenue reached $482,000, and cash cover is now 47 days.";
    expect(fabricatedFigures(source, generated)).toContain("47");
  });

  it("catches an invented percentage", () => {
    const generated = "Revenue rose 8.4%, and overheads climbed 19.6%.";
    expect(fabricatedFigures(source, generated)).toContain("19.6%");
  });

  it("tolerates small integers used as ordinary prose", () => {
    const generated = "Revenue was $482,000, up 8.4%. The next three months matter most.";
    expect(fabricatedFigures(source, generated)).toEqual([]);
  });

  it("does not tolerate a small percentage that was never measured", () => {
    expect(fabricatedFigures(source, "Margin slipped 2.0%.")).toContain("2%");
  });

  it("passes an empty rewrite rather than inventing a failure", () => {
    expect(fabricatedFigures(source, "")).toEqual([]);
  });
});

/**
 * Regression: trailing-zero normalisation used to skip percentages entirely, so a
 * faithful rewrite of "8.40%" as "8.4%" was reported as fabricated and discarded.
 */
describe("figuresIn percentage normalisation", () => {
  it("normalises trailing zeros on percentages as it does on plain numbers", () => {
    expect(figuresIn("8.40%")).toEqual(["8.4%"]);
    expect(figuresIn("31.0%")).toEqual(["31%"]);
  });

  it("treats an equivalently-written percentage as the same figure", () => {
    expect(fabricatedFigures("Margin was 8.40%.", "Margin was 8.4%.")).toEqual([]);
  });
});

/**
 * The rule that keeps an edit honest: an advisor's wording survives anything that does not
 * change the figures, and nothing that does.
 */
describe("summaryFingerprint", () => {
  const beats = (revenue: string) => [
    { kicker: "What happened", headline: "A bigger month", body: [`Revenue was ${revenue}.`] },
  ];

  it("is stable across recomputation from unchanged facts", () => {
    expect(summaryFingerprint(beats("$482,000"))).toBe(summaryFingerprint(beats("$482,000")));
  });

  it("changes when a figure moves", () => {
    expect(summaryFingerprint(beats("$482,000"))).not.toBe(
      summaryFingerprint(beats("$501,000")),
    );
  });

  it("changes when a headline changes even if the figures do not", () => {
    const a = [{ kicker: "K", headline: "A bigger month", body: ["Revenue was $1."] }];
    const b = [{ kicker: "K", headline: "A smaller month", body: ["Revenue was $1."] }];
    expect(summaryFingerprint(a)).not.toBe(summaryFingerprint(b));
  });

  it("changes when a beat is added", () => {
    const one = beats("$482,000");
    const two = [...one, { kicker: "Risk", headline: "Watch cash", body: ["Cash is tight."] }];
    expect(summaryFingerprint(one)).not.toBe(summaryFingerprint(two));
  });

  it("handles an empty summary without throwing", () => {
    expect(summaryFingerprint([])).toBe(summaryFingerprint([]));
    expect(summaryFingerprint([])).toMatch(/^[0-9a-f]{8}$/);
  });
});
