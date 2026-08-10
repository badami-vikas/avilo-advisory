/**
 * The worked examples in the assistant's system prompt, checked like real model output.
 *
 * The examples are the part of the prompt the model actually copies. When one is malformed
 * the failure surfaces nowhere useful: the model imitates it, the imitation is refused by
 * `validateBlueprint`, and the refusal reads as the model's mistake. This test puts the
 * examples through the same validator the model's output goes through, so a bad example
 * fails here instead of silently degrading every reply.
 *
 * Written after the `declares` list in the prompt was found to name only five levers while
 * the prompt above it described eight — the model was being told to declare something it
 * had just been told was not allowed.
 */
import { describe, expect, it } from "vitest";
import { validateBlueprint, type BlueprintSection } from "@avilo/core";
import { SYSTEM_PROMPT } from "../src/services/copilot.js";
import { registeredSurface } from "../src/services/blueprint.js";

/** Every fenced blueprint block in the prompt, minus the `{...}` shape illustration. */
function exampleBlocks(): string[] {
  return [...SYSTEM_PROMPT.matchAll(/```avilo-blueprint\n([\s\S]*?)\n```/g)]
    .map((m) => m[1]!)
    .filter((body) => !body.includes("[...]"));
}

/**
 * Every lever a worked example may declare: the configuration sections, `viewsPatch` (the
 * safer route to the `views` lever), and the four client-scoped levers.
 *
 * `string[]` rather than `BlueprintSection[]` because the client levers are deliberately not
 * blueprint sections — they are applied by `client-levers.ts`, which lives outside the MCP
 * module graph so an external agent cannot reach a client's own rows.
 */
const ALL_LEVERS: string[] = [
  "formulas",
  "mappings",
  "prompts",
  "layout",
  "views",
  "viewsPatch",
  "dashboard",
  "clientsTable",
  "landingTiles",
  "accountLabels",
  "notes",
  "actionAssignments",
  "clientMeta",
  "clientLayout",
];

describe("the assistant's worked examples", () => {
  it("finds the examples at all", () => {
    // Guards the regex itself: a silently-empty match set would make every test below pass.
    expect(exampleBlocks().length).toBeGreaterThanOrEqual(3);
  });

  it("every example is strict JSON", () => {
    for (const body of exampleBlocks()) {
      expect(() => JSON.parse(body), body.slice(0, 80)).not.toThrow();
    }
  });

  it("every example validates against the live registry", () => {
    for (const body of exampleBlocks()) {
      const result = validateBlueprint(JSON.parse(body), registeredSurface());
      expect(result.errors, `${body.slice(0, 80)}: ${JSON.stringify(result.errors)}`).toEqual([]);
    }
  });

  it("every example declares exactly the sections it carries", () => {
    for (const body of exampleBlocks()) {
      const doc = JSON.parse(body) as Record<string, unknown> & { declares?: string[] };
      expect(Array.isArray(doc.declares)).toBe(true);
      for (const section of doc.declares!) {
        expect(ALL_LEVERS).toContain(section);
        // A declared lever with nothing under it teaches an empty declaration.
        const carried = doc[section];
        expect(Array.isArray(carried) ? carried.length > 0 : carried !== undefined).toBe(true);
      }
    }
  });

  /*
    The defect that started this file. The prompt described eight levers and then told the
    model `declares` accepted five of them, so the three arrangement levers were unreachable
    in practice: declaring one looked forbidden, and omitting it refuses the whole document.
  */
  it("tells the model that declares accepts all eight levers", () => {
    const list = /"declares" array naming the levers you are changing[\s\S]{0,200}/.exec(
      SYSTEM_PROMPT,
    );
    expect(list).not.toBeNull();
    for (const lever of ALL_LEVERS) {
      expect(list![0]).toContain(`"${lever}"`);
    }
  });

  /*
    Summary house style is a `prompts` change. Without an example the model refused these as
    "not one of my levers" — the capability existed and was unreachable, which is the same
    failure shape as BUG-033 to BUG-036.
  */
  it("carries an example of restyling the executive summary", () => {
    const promptExamples = exampleBlocks().filter((b) =>
      (JSON.parse(b) as { declares?: string[] }).declares?.includes("prompts"),
    );
    expect(promptExamples.length).toBeGreaterThanOrEqual(1);

    const body = (
      JSON.parse(promptExamples[0]!) as { prompts: { key: string; body: string }[] }
    ).prompts.find((p) => p.key === "narrative_guidance")!.body;

    // The rule that makes generated prose safe is not house style, and an example that
    // drops it teaches the model to drop it.
    expect(body).toContain("Use ONLY the figures and facts given");
  });
});

/*
  BUG-042. The examples used to pad every block with "formulas":[],"mappings":[],"prompts":[]
  while the instruction three paragraphs above said "Include ONLY the section you are
  actually changing". Where an instruction and an example disagree, the example wins — the
  model padded its documents too, and a "views":[] in that padding deleted every view.
*/
describe("the examples do not teach padding", () => {
  it("no example carries an empty section", () => {
    for (const body of exampleBlocks()) {
      const doc = JSON.parse(body) as Record<string, unknown>;
      for (const [key, value] of Object.entries(doc)) {
        if (key === "declares") continue;
        expect(Array.isArray(value) && value.length === 0, `${key} is empty in ${body.slice(0, 60)}`).toBe(false);
      }
    }
  });

  it("tells the model in words as well", () => {
    expect(SYSTEM_PROMPT).toContain("Send NO empty sections");
  });
});

/*
  BUG-044. `declares` is parsed through a hard-coded list, and a lever missing from that list
  cannot be declared — after which its changes are refused as out of scope (ADR-045). The
  three arrangement levers were added to the grammar, the prompt and the write path, but not
  to that list, so they were unreachable through the panel no matter what the prompt said.
  A prompt fix would have looked correct and changed nothing.
*/
describe("the declares parser", () => {
  it("accepts every lever the grammar has", async () => {
    const { extractBlueprintBlock } = await import("../src/services/copilot.js");
    const block =
      '```avilo-blueprint\n{"declares":["dashboard","clientsTable","landingTiles","prompts"],' +
      '"schemaVersion":1,"name":"n","exportedAt":"2026-01-01T00:00:00.000Z","dashboard":{"hidden":["warnings"]}}\n```';
    const parsed = extractBlueprintBlock(`Hiding that panel.\n${block}`);
    expect(parsed.declared).toEqual(["dashboard", "clientsTable", "landingTiles", "prompts"]);
  });
});
