// The right-panel AI chatbot's backing service.
//
// This is Avilo's counterpart to relationship-os's Chief of Staff `converse` — same shape
// (a chat turn in, a reply and an optional routed action out), narrowed to what Avilo has:
// no multi-agent routing, no Approvals surface, one action kind instead of many. Where
// theirs routes to a proposal visible in Approvals, this routes to a blueprint proposal
// visible in the panel's own review list (`blueprint.list`) — same principle, "a routed
// action is a real proposal, never fabricated feed content", scaled to one app's surface.
//
// The chatbot answers questions about the running app freely — it is told the current
// configuration, the registered accounts/formulas/prompts, and (when a client is open) that
// client's real imported periods and data gaps, so "what is missing for this client" is
// answered from the same queries the report view runs rather than guessed in the abstract.
//
// It ACTS rather than recommends: a candidate AviloBlueprint JSON block in its reply goes
// through `applyBlueprintDirectly`, which validates against the live registry and then
// applies. Validation is unchanged from the propose/activate path — an invented formula or
// account id is refused outright and nothing is written — so what the direct path removes
// is the human click, not a guard. The configuration as it stood beforehand is snapshotted
// as its own proposal first and returned as `revertId`, which is what the panel's Undo
// activates.
//
// Still out of reach, structurally: source code, UI, financial facts, file imports. There is
// no tool call wired to any of those, only to configuration.

import { eq } from "drizzle-orm";

import { ACCOUNTS_BY_ID, CANONICAL_ACCOUNTS } from "@avilo/module";
import { getDb, schema } from "../db.js";
import { callGroq, groqConfig } from "./ai.js";
import {
  applyBlueprintDirectly,
  describeBlueprintChange,
  type BlueprintSection,
  currentConfiguration,
  registeredSurface,
  DETAIL_KINDS,
  VIEW_ACTIONS,
} from "./blueprint.js";
import { availablePeriods, buildPeriodReport } from "./report.js";

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

export interface CopilotReply {
  text: string;
  /** Present when the assistant changed configuration — already applied, not pending. */
  appliedSummary?: string;
  appliedChanges?: string[];
  /** Activating this proposal restores the configuration as it stood before. */
  revertId?: string;
  /** The model emitted a document identical to the live configuration; nothing was written. */
  noChange?: true;
  /** The reply claimed to have changed something, and nothing was changed. Shown as a correction. */
  falseClaim?: true;
  /** Present instead when the candidate failed validation; nothing was written. */
  proposalErrors?: { path: string; message: string }[];
  /**
   * The document would have changed levers the assistant never declared. Nothing was
   * written; this is what was refused (BUG-033).
   */
  outOfScope?: { declared: BlueprintSection[]; undeclared: BlueprintSection[]; changes: string[] };
  /**
   * A change WAS applied, but the reply's prose points at levers that did not move — so the
   * sentence above the change list is describing something other than what happened
   * (BUG-034). The change list is the record; this marks the prose as unreliable.
   */
  misdescribed?: BlueprintSection[];
}

const SYSTEM_PROMPT = `You are the Avilo Advisory in-app assistant.

You configure and BUILD this app. You have exactly FIVE levers, and nothing else:

  1. formulas — the expressions behind every computed metric. You may EDIT an existing one
     or CREATE a new one (a new id creates a new metric, available everywhere at once).
  2. mappings — which QuickBooks row label feeds which canonical account
  3. prompts — the two AI guidance texts
  4. layout — the default report's section order and which sections are hidden
  5. views — whole new screens you compose from approved components, which appear in the
     client page's View picker beside Standard/Report/Raw data/Dashboard

When the user asks for something ON that list, DO IT. Emit the blueprint block below and it
is applied immediately, with an Undo shown to the user. Do not describe what you could
propose, do not ask them to review anything. Answer as someone who just did the thing.

BUILDING A VIEW is how you answer "make me a screen for X", "build a dashboard for X", "I
want a page showing X", or "add a button for X". A view has a label and a list of
components. The component types, and what each one BINDS to:

  {"type":"metric","label":"...","valueId":"<account or formula id>"}
  {"type":"chart","label":"...","series":[{"id":"<account or formula id>","kind":"bar"|"line"}]}
  {"type":"table","label":"...","source":"<one of the table sources you were given>"}
  {"type":"text","label":"...","body":"your own words"}
  {"type":"actions","label":"...","buttons":["<one of the actions you were given>"]}

A component NEVER carries a number. A metric names an id and the app looks the figure up; a
chart names series ids and the app supplies the points. This is not a style preference — you
have no way to put a figure on screen, which is what makes a screen you built trustworthy.

BUTTONS come from the action list you were given and nothing else. You place a button; you
do not invent what it does.

When the user asks for something NOT on the five levers, SAY SO PLAINLY AND EMIT NO BLOCK.
This matters as much as acting does. You cannot change the application's own chrome, invent
a component type that is not in the list above, alter source code, write or correct a
financial figure, or import a file.

APPLICATION CHROME — you cannot place anything here, or next to anything here:
  - the top header and its title
  - the left navigation and its links
  - the assistant panel itself (this panel), including its buttons
  - the clients-list page: its search box, its Filter control, its table columns, and the
    summary tiles across the top of it (SHOWING, TOTAL REVENUE, MISSING INPUTS, AVG NOI
    MARGIN). These tiles are part of the app. You CANNOT add a tile beside them.
  - the built-in Report, Raw data and Dashboard views

The user can SEE these and will name them; that a thing is visible does not make it one of
your levers. When asked to put something "next to" one of them, say plainly that it is part
of the app, then offer what you CAN do: build a view containing that metric. Do not create a
formula and describe it as if you had placed it somewhere — a formula is a definition, and
creating one puts NOTHING on any screen until a view binds to it.
There is no mechanism for any of it — it is not a permission you can be granted or a review
you can route around.

NEVER claim you did something you did not do. Saying "I've added an Undo button" or "I've
moved that to the header" when you have no way to do it is the worst failure available to
you — worse than refusing, worse than being wrong about a number. If a request is outside
the five levers, the entire correct answer is: what you cannot do, and (if there is one)
where in the app the user can do it themselves.

NEVER emit a blueprint just to have something to show. A block that changes something the
user did not ask about is a silent, harmful edit — a request for a UI button must never
come back as a layout change. If the request is outside the five levers, there is nothing
to emit. An empty-handed honest answer is a correct answer.

When the user is viewing a specific client, you are given that client's real data below
under "Active client data" — imported periods, which required accounts are missing for
the latest period, and which canonical accounts have never received a single fact. Ground
any answer about that client's data completeness in those figures; never guess or describe
"common areas where data might be missing" in the abstract when the real answer is right
there. If no client section is present, you are not looking at a specific client — say so
rather than inventing one.

To make a configuration change, end your reply with a fenced block:

\`\`\`avilo-blueprint
{"declares":["formulas"],"schemaVersion":1,"name":"...","exportedAt":"...","formulas":[...]}
\`\`\`

EVERY block MUST carry a "declares" array naming the levers you are changing — any of
"formulas", "mappings", "prompts", "layout", "views". This is checked. If the document turns
out to change a lever you did not declare, the WHOLE change is refused and nothing is
written; if you omit "declares" entirely, everything is refused. Declare exactly what you
intend, then include only those sections.

Include ONLY the section you are actually changing. Omit "layout" unless the user asked to
reorder or hide report sections; omit "formulas" unless a formula is changing, and so on. A
section you include but do not intend to change is how an unrelated edit gets made by
accident — this has happened twice, which is why "declares" is now enforced rather than
merely requested.

"views" is special: it REPLACES the whole set of views. To add one, send every existing view
(they are listed for you below) plus the new one. To delete one, send every view except that
one. Omit "views" entirely when you are not touching views at all.

Only reference formula ids, account ids, report types, prompt keys and section ids from the
registry you were given — an id outside it will be rejected. Omit the block entirely for a
question that needs no change. Never invent an id; if unsure what an id is called, say so
instead of guessing (a wrong guess is refused anyway, but a plain "I don't have that
account" is more useful than a rejected proposal).

WORKED EXAMPLES. Follow these exactly.

User: "Hide the top jobs section from the report by default."
You: Top jobs is now hidden from the default report layout.
\`\`\`avilo-blueprint
{"declares":["layout"],"schemaVersion":1,"name":"Hide top jobs","exportedAt":"2026-01-01T00:00:00.000Z","formulas":[],"mappings":[],"prompts":[],"layout":{"hiddenSections":["top-jobs"]}}
\`\`\`
(Note: the id is "top-jobs", from the registered section ids. Hiding a section is a LAYOUT
change — it is lever 4, it is in scope, and it MUST come with a block. Answering "I've
updated the layout" without a block is a lie.)

User: "Build me a dashboard for monitoring overdue invoices."
You: Built it — "Overdue invoices" is in the View picker now.
\`\`\`avilo-blueprint
{"declares":["views"],"schemaVersion":1,"name":"Overdue invoices view","exportedAt":"2026-01-01T00:00:00.000Z","formulas":[],"mappings":[],"prompts":[],"views":[{"id":"overdue-invoices","label":"Overdue invoices","layout":"grid","components":[{"id":"ar-total","type":"metric","label":"Total receivable","valueId":"ar.total"},{"id":"dso","type":"metric","label":"Days sales outstanding","valueId":"dso"},{"id":"ar-trend","type":"chart","label":"Receivables over time","series":[{"id":"ar.total","kind":"bar"}]},{"id":"ar-by-customer","type":"table","label":"By customer","source":"ar_customer"},{"id":"go","type":"actions","label":"Next step","buttons":["export-pdf"]}]}]}
\`\`\`
(Every figure is a BINDING — "ar.total", "dso" — never a number. The block carries every
existing view plus this one, because "views" replaces the whole set.)

User: "Add an undo button to the assistant header."
You: I can't add or move a button — the assistant's own interface isn't something I can
change. I can only change formulas, QuickBooks mappings, AI prompts, and the default report
layout.
(No block. The assistant's own panel is application chrome, not one of the five levers. A
button inside a VIEW you built would be fine; this is not that.)

User: "Next to Avg NOI Margin, can you add Avg Net Op. Income"
You: Those tiles across the top of the clients list are part of the app, so I can't add one
beside them. What I can do is create an "Average net operating income" metric and put it on
a view — say the word and I'll build one.
(No block. Note what is NOT done here: a formula is not created and then described as though
it had been placed somewhere. Creating a formula puts nothing on screen. If the user then
says "yes, build the view", THAT turn declares ["formulas","views"] and does both.)

User: "What's missing for this client?"
You: [answer from the Active client data section]
(No block. A question is not a change.)`;

function buildContext(): string {
  const surface = registeredSurface();
  const config = currentConfiguration();
  return [
    `Registered account ids: ${[...surface.accountIds].sort().join(", ")}`,
    `Registered formula ids: ${[...surface.formulaIds].sort().join(", ")}`,
    `Registered report types: ${[...surface.reportTypes].sort().join(", ")}`,
    `Registered prompt keys: ${[...surface.promptKeys].sort().join(", ")}`,
    `Registered report section ids, in default order: ${[...surface.sectionIds].join(", ")}`,
    `Current formulas: ${JSON.stringify(config.formulas)}`,
    `Current label mapping count: ${config.mappings.length} (omitted for brevity)`,
    `Current prompts: ${JSON.stringify(config.prompts)}`,
    `Current default report layout: ${config.layout ? JSON.stringify(config.layout) : "unset (uses the built-in default order, nothing hidden)"}`,
    `Table sources a view may bind to: ${DETAIL_KINDS.join(", ")}`,
    `Actions a button may invoke: ${VIEW_ACTIONS.join(", ")}`,
    `Existing views (send these back with any new one, since "views" replaces the whole set): ${
      config.views && config.views.length > 0 ? JSON.stringify(config.views) : "none yet"
    }`,
  ].join("\n");
}

/**
 * Read-only summary of one client's actual books — real periods, real missing-account
 * gaps for the latest period, and canonical accounts that have never received a fact for
 * this client at all. Composed from the same queries the report view and dashboard use
 * (`availablePeriods`/`buildPeriodReport` in report.ts), not a separate source of truth,
 * so the assistant's answer about "what's missing" can never diverge from what the client
 * detail page itself shows. This is read-only: nothing here can be written back by the
 * model, same as every other fact this file feeds it.
 */
function clientDataSummary(clientId: string): string {
  const db = getDb();
  const client = db.select().from(schema.clients).where(eq(schema.clients.id, clientId)).get();
  if (!client) return `Active client: unknown client id "${clientId}" (not found).`;

  const periods = availablePeriods(clientId);
  if (periods.length === 0) {
    return [
      `Active client: ${client.name} (id ${clientId}).`,
      `No periods imported yet — nothing has been uploaded for this client.`,
    ].join("\n");
  }

  const latest = periods[0]!;
  const report = buildPeriodReport(clientId, latest);
  const missing = report.missingRequired.map(
    (id) => `${id} (${ACCOUNTS_BY_ID.get(id)?.label ?? id})`,
  );

  const everHad = new Set<string>(
    db
      .selectDistinct({ accountId: schema.facts.accountId })
      .from(schema.facts)
      .where(eq(schema.facts.clientId, clientId))
      .all()
      .map((r) => r.accountId),
  );
  const neverPopulated = CANONICAL_ACCOUNTS.filter((a) => !everHad.has(a.id)).map(
    (a) => `${a.id} (${a.label}, ${a.statement})`,
  );

  const files = db
    .select({ filename: schema.sourceFiles.filename, status: schema.sourceFiles.status, reportType: schema.sourceFiles.reportType })
    .from(schema.sourceFiles)
    .where(eq(schema.sourceFiles.clientId, clientId))
    .all();
  const failedFiles = files.filter((f) => f.status === "failed");

  return [
    `Active client: ${client.name} (id ${clientId}).`,
    `Imported periods: ${periods.length} (${periods[periods.length - 1]} through ${latest}).`,
    `Latest period ${latest}: ${report.complete ? "complete — every account an active formula needs has a value" : `INCOMPLETE — missing ${missing.length} required account(s): ${missing.join(", ")}`}.`,
    `Canonical accounts that have NEVER received a single fact for this client, across all ${periods.length} imported period(s) (${neverPopulated.length} of ${CANONICAL_ACCOUNTS.length}): ${neverPopulated.length > 0 ? neverPopulated.join("; ") : "none — every canonical account has data at least once"}.`,
    `Imported files: ${files.length} total${failedFiles.length > 0 ? `, ${failedFiles.length} FAILED (${failedFiles.map((f) => f.filename).join(", ")})` : ""}.`,
  ].join("\n");
}


/**
 * Does this reply claim to have changed something?
 *
 * The backstop for BUG-032. Prompting alone does not hold: told to act, the model will
 * write "I've updated the default report layout" and emit no blueprint at all, or one that
 * changes nothing. The prose is then the only thing the user sees, and it is false. So the
 * server checks the claim against what it actually wrote, and when they disagree, the
 * server wins — the reply is annotated with the truth rather than passed through.
 *
 * Deliberately loose: a false positive costs one redundant clarifying line under an answer
 * that changed nothing anyway, while a false negative is an unchallenged lie.
 */
export const CLAIMS_AN_ACTION =
  /\bI(?:'ve|\s+have)?\s+(?:just\s+)?(?:updated|changed|added|removed|hidden|hid|moved|set|configured|applied|modified|created|adjusted|reordered|renamed|enabled|disabled)\b/i;

const SECTIONS: readonly BlueprintSection[] = [
  "formulas", "mappings", "prompts", "layout", "views",
];

/**
 * Pull the reply, the document, and the document's own `declares` list apart.
 *
 * `declares` rides on the emitted JSON but is NOT part of a blueprint —
 * `validateBlueprint` rebuilds the document from known fields only, so it is dropped before
 * anything is stored and an exported blueprint never carries it. It exists purely as the
 * model's statement of intent, made before it can see the diff, so the server has something
 * to hold it to (BUG-033).
 */
function extractBlueprintBlock(text: string): {
  reply: string;
  candidate: unknown | null;
  declared: BlueprintSection[] | null;
} {
  const match = /```avilo-blueprint\s*([\s\S]*?)```/.exec(text);
  if (!match) return { reply: text.trim(), candidate: null, declared: null };

  const reply = (text.slice(0, match.index) + text.slice(match.index + match[0].length)).trim();
  try {
    const parsed = JSON.parse(match[1]!.trim()) as Record<string, unknown>;
    const raw = Array.isArray(parsed.declares) ? parsed.declares : null;
    const declared = raw
      ? (raw.filter((d): d is BlueprintSection => SECTIONS.includes(d as BlueprintSection)))
      : null;
    return { reply, candidate: parsed, declared };
  } catch {
    return { reply, candidate: null, declared: null };
  }
}

/**
 * Which levers does this reply's PROSE claim to have touched?
 *
 * The backstop for BUG-034. `CLAIMS_AN_ACTION` only ever ran when nothing was written, so
 * "I've added a metric next to Avg NOI Margin" could sit above a card reading `Added view
 * "Profitability"` with nothing to contradict it — and the green card lent the false
 * sentence credibility. This reads the prose the same crude way, and the caller compares it
 * to the diff that was actually applied.
 *
 * Deliberately keyword-based and deliberately loose. It cannot understand the sentence; it
 * only has to notice that the words point at a different lever from the one that moved.
 */
export function levelsClaimedInProse(text: string): Set<BlueprintSection> {
  const claimed = new Set<BlueprintSection>();
  const t = text.toLowerCase();
  if (/\bmetric\b|\bformula\b|\bcalculat/.test(t)) claimed.add("formulas");
  if (/\bview\b|\bscreen\b|\bdashboard\b|\bpage\b|\btab\b/.test(t)) claimed.add("views");
  if (/\bmapping\b|\bquickbooks row\b|\blabel\b/.test(t)) claimed.add("mappings");
  if (/\bprompt\b|\bguidance\b/.test(t)) claimed.add("prompts");
  if (/\blayout\b|\bsection\b|\bhid(e|den)?\b|\breorder|\border of\b/.test(t)) claimed.add("layout");
  return claimed;
}

/**
 * One chat turn: send the conversation plus a description of the live configuration to
 * Groq, and if the reply proposes a change, validate and record it as a blueprint
 * proposal. Returns `null` when no model is configured — callers must handle that
 * (AI is additive everywhere, ADR-010), not fall back to a canned reply.
 */
export async function converse(history: ChatTurn[], clientId?: string): Promise<CopilotReply | null> {
  const config = groqConfig();
  if (!config) return null;

  const prompt = [
    SYSTEM_PROMPT,
    "",
    "--- Current configuration ---",
    buildContext(),
    ...(clientId ? ["", "--- Active client data ---", clientDataSummary(clientId)] : []),
    "",
    "--- Conversation ---",
    ...history.map((turn) => `${turn.role === "user" ? "User" : "Assistant"}: ${turn.text}`),
    "Assistant:",
  ].join("\n");

  const raw = await callGroq(config, prompt, 1200);
  const { reply, candidate, declared } = extractBlueprintBlock(raw);

  /*
    No blueprint at all. Usually that is right — a question needs no change. But when the
    reply also claims to have done something, the claim is false and the user has no way to
    tell: there is no card, no diff, nothing to contradict the prose. Say so outright.
  */
  if (candidate === null) {
    const text = reply || raw.trim();
    return CLAIMS_AN_ACTION.test(text) ? { text, falseClaim: true } : { text };
  }

  const summary = history[history.length - 1]?.text.slice(0, 120) ?? "Assistant change";

  /*
    An omitted `declares` is treated as declaring nothing, so any diff at all is out of
    scope and the document is refused. That is on purpose: making the declaration optional
    would make the guard optional, and the failure it exists to catch (BUG-033) is exactly
    the model being careless about which levers its document touches. The refusal names the
    missing field, so the model can correct it on the next turn.
  */
  const outcome = applyBlueprintDirectly("assistant", summary, candidate, declared ?? []);

  if ("errors" in outcome) {
    return {
      text: reply || raw.trim(),
      proposalErrors: outcome.errors,
    };
  }

  /*
    The model emitted a document, but it matches what is already live. Nothing was written
    and nothing is claimed — the reply text stands on its own. Without this the panel would
    say "Change applied" over an empty diff (BUG-030).
  */
  if ("noChange" in outcome) {
    const text = reply || raw.trim();
    return CLAIMS_AN_ACTION.test(text) ? { text, falseClaim: true } : { text, noChange: true };
  }

  /*
    The document changed something the assistant never said it would. Nothing was written —
    not the change, not the snapshot — and the user is told exactly what was refused.
    Refusing whole rather than filtering: a partly-applied change is the state this pipeline
    exists to prevent (BUG-033).
  */
  if ("outOfScope" in outcome) {
    return {
      text: reply || raw.trim(),
      outOfScope: outcome.outOfScope,
    };
  }

  const applied = outcome.proposal.diff;
  const actualSections = new Set(applied.map((c) => c.section));
  const claimedSections = levelsClaimedInProse(reply || raw.trim());

  /*
    BUG-034: the prose and the diff describe different things. Only flag when the prose
    positively points at a lever that did NOT move — prose that simply says less than the
    diff is imprecise, not false, and the change list beneath it is the record either way.
  */
  const misdescribed = [...claimedSections].filter((c) => !actualSections.has(c));

  return {
    text: reply || raw.trim(),
    appliedSummary: outcome.proposal.summary,
    appliedChanges: applied.map(describeBlueprintChange),
    revertId: outcome.revertId,
    ...(misdescribed.length > 0 ? { misdescribed } : {}),
  };
}
