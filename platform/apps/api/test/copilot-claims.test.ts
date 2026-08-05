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
import { CLAIMS_AN_ACTION } from "../src/services/copilot.js";

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
