/**
 * The assistant must never be the only witness to its own actions.
 *
 * BUG-029/BUG-032: told to act rather than recommend, the model began claiming changes it
 * had not made — "I've added an Undo button" (a thing it cannot do at all) and "I've
 * updated the default report layout" with no blueprint emitted. Prompting alone did not
 * hold. These tests pin the server-side backstop: a claim is checked against what was
 * actually written, and the server's answer is what reaches the user.
 */
import { describe, expect, it } from "vitest";
import { levelsClaimedInProse, CLAIMS_AN_ACTION } from "../src/services/copilot.js";

describe("detecting a claimed action", () => {
  it("catches the exact claims that shipped in 1.9.2", () => {
    for (const text of [
      "I've added an Undo button for your Avilo assistant.",
      "I've moved the Undo button to the header of the Avilo assistant.",
      "I've updated the default report layout to hide the top jobs section.",
      "I have changed the DSO formula for you.",
      "I just hid the referrals section.",
      "I've set the accounting guidance prompt.",
    ]) {
      expect(CLAIMS_AN_ACTION.test(text), text).toBe(true);
    }
  });

  it("leaves an honest refusal or a plain answer alone", () => {
    for (const text of [
      "I cannot add a button or move a control. This is outside the four levers I can configure.",
      "For Phoenix Restoration Co., three canonical accounts have never received a fact.",
      "The DSO formula divides accounts receivable by average revenue.",
      "You can change that yourself from the report's format panel.",
      "I would need to know which section you mean before changing anything.",
    ]) {
      expect(CLAIMS_AN_ACTION.test(text), text).toBe(false);
    }
  });
});

/**
 * BUG-034: the prose pointed at a lever that had not moved.
 *
 * Pinned against the sentences from the shipped screenshot. `CLAIMS_AN_ACTION` could never
 * catch these — a change WAS applied, so it never ran — which is the gap this closes.
 */
describe("levelsClaimedInProse", () => {
  it("reads the lever the shipped false descriptions pointed at", () => {
    // Turn one: said "metric", actually created only a formula and placed nothing.
    expect([...levelsClaimedInProse("I've added a new metric next to Avd NOI Margin.")]).toContain(
      "formulas",
    );

    // Turn two: said "metric", the diff was a VIEW. Claiming formulas while views moved is
    // exactly the mismatch that must be flagged.
    const turnTwo = levelsClaimedInProse(
      'I\'ve added a new metric next to Avd NOI Margin, binding to the "avg_net_operating_income" formula.',
    );
    expect(turnTwo.has("formulas")).toBe(true);
    expect(turnTwo.has("views")).toBe(false);
  });

  it("recognises each lever by the words a reply actually uses", () => {
    expect(levelsClaimedInProse("Built the Profitability view").has("views")).toBe(true);
    expect(levelsClaimedInProse("hid the top jobs section").has("layout")).toBe(true);
    expect(levelsClaimedInProse("mapped that QuickBooks row label").has("mappings")).toBe(true);
    expect(levelsClaimedInProse("rewrote the accounting guidance prompt").has("prompts")).toBe(true);
  });

  it("claims nothing for a plain answer, so an ordinary reply is never flagged", () => {
    expect([...levelsClaimedInProse("Revenue for October was the highest of the year.")]).toEqual([]);
  });
});
