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
import { levelsClaimedInProse, serverNarration, deniesActing, CLAIMS_AN_ACTION } from "../src/services/copilot.js";

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

/**
 * The server's account replaces the model's, rather than being printed beneath it.
 *
 * Two rounds of correction cards (BUG-030, BUG-034) established that the app could DETECT a
 * false claim. They left it on screen and argued with it underneath, which still puts the
 * false sentence in front of the user. These pin the swap: where the server knows what
 * happened, `text` is the server's sentence and the model's is carried in `suppressed`.
 */
describe("serverNarration", () => {
  it("describes nothing as nothing", () => {
    expect(serverNarration([])).toBe("No configuration change was made.");
  });

  it("names the single change it was given", () => {
    expect(serverNarration(["Dashboard — hid warnings"])).toBe(
      "Applied one change: dashboard — hid warnings.",
    );
  });

  it("counts and lists several", () => {
    const text = serverNarration(["Dashboard — hid warnings", "Portfolio tiles — changed"]);
    expect(text).toContain("Applied 2 changes");
    expect(text).toContain("dashboard — hid warnings");
    expect(text).toContain("portfolio tiles — changed");
  });

  /*
    The property that matters: this sentence is built from the change list, so there is no
    input to it that the model authors. It cannot claim a lever that did not move, because
    it never sees the model's prose at all.
  */
  it("can only say what the diff says", () => {
    const changes = ["Formula avg_noi added: avg3.net_operating_income"];
    expect(serverNarration(changes)).not.toContain("view");
    expect(serverNarration(changes)).toContain("formula avg_noi");
  });
});

/*
  BUG-043. The mirror image of BUG-034: prose that DENIES acting while a change was applied.
  Shown to the user as a refusal printed directly above a "Change applied" card listing three
  deleted views. `misdescribed` cannot catch this — a refusal naming no lever claims nothing.
*/
describe("deniesActing", () => {
  it("catches the refusal forms a model actually produces", () => {
    for (const text of [
      "I can't change the styling or formatting of the executive summary text.",
      "I cannot alter that.",
      "This is outside the five levers I can configure.",
      "That is outside the eight levers.",
      "I'm not able to do that.",
      "I am unable to change the header.",
      "Formatting is not something I can change.",
      "I don't have the ability to move that button.",
    ]) {
      expect(deniesActing(text), text).toBe(true);
    }
  });

  it("does not fire on an ordinary report of work done", () => {
    for (const text of [
      "Done — the summary is now one paragraph, with gains in green.",
      "Top jobs is now hidden from the default report layout.",
      "Built it — \"Overdue invoices\" is in the View picker now.",
      "I've created the metric and put it on a view.",
      // "can" alone must not trip it; the bar is a refusal, not a modal verb.
      "You can now see the overdue accounts on the dashboard.",
    ]) {
      expect(deniesActing(text), text).toBe(false);
    }
  });
});
