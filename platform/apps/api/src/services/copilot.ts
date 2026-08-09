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
  DEFAULT_HIDDEN_CLIENTS_COLUMNS,
  DEFAULT_LANDING_TILES,
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
  /**
   * The model's own wording was WITHHELD and replaced by `text`, because it did not match
   * what the server actually did.
   *
   * The correction cards below this were the previous answer to a model that claims work it
   * did not do: print the claim, then rebut it underneath. That is honest but it still puts
   * the false sentence in front of the user — they read it, and being told afterwards that
   * it was wrong does not un-read it. Where the server knows the truth, the server's account
   * is the one that gets shown, and the model's is simply not rendered.
   *
   * `original` is carried so the panel can offer it on demand: withheld is not the same as
   * hidden, and a user debugging their assistant should be able to see what it said.
   */
  suppressed?: { reason: "false-claim" | "misdescribed" | "denied"; original: string };
}

/**
 * Does this reply disown the change that sits beneath it?
 *
 * Matched on the refusal itself rather than on any lever noun, because that is what makes it
 * different from a misdescription: the sentence is about whether the turn did anything at
 * all. Kept narrow — these are the forms a refusal actually takes, and the cost of a false
 * positive is a correct sentence replaced by a correct sentence, which is why the bar sits
 * here and not at "mentions the word cannot".
 */
export function deniesActing(text: string): boolean {
  return /\b(?:i\s+can(?:no|')?t|i\s+cannot|i(?:'m| am)\s+(?:not\s+able|unable)|not\s+something\s+i\s+can|outside\s+the\s+(?:\w+\s+)?levers|i\s+don'?t\s+have\s+the\s+ability)\b/i.test(
    text,
  );
}

/**
 * What happened, in the server's own words, built from the diff rather than from the model.
 *
 * This is the sentence shown when the model's prose is withheld. It cannot be wrong about
 * what changed, because it is generated from the change list itself — the same source the
 * panel's "Change applied" card reads.
 */
export function serverNarration(changes: string[]): string {
  if (changes.length === 0) return "No configuration change was made.";
  if (changes.length === 1) return `Applied one change: ${changes[0]!.toLowerCase()}.`;
  return `Applied ${changes.length} changes: ${changes
    .map((c) => c.toLowerCase())
    .join("; ")}.`;
}

/**
 * Exported so `copilot-examples.test.ts` can hold the worked examples to the same standard
 * the model is held to: every blueprint in here must parse and must validate against the
 * live registry.
 *
 * A worked example is the most load-bearing text in this prompt — it is what the model
 * copies. A malformed one teaches malformed output, and nothing else in the system would
 * ever report it, because the model's imitation of a broken example fails at validation
 * where it looks like the model's fault.
 */
export const SYSTEM_PROMPT = `You are the Avilo Advisory in-app assistant.

You configure and BUILD this app. You have exactly EIGHT levers, and nothing else:

  1. formulas — the expressions behind every computed metric. You may EDIT an existing one
     or CREATE a new one (a new id creates a new metric, available everywhere at once).
  2. mappings — which QuickBooks row label feeds which canonical account
  3. prompts — the two AI guidance texts. \`accounting_guidance\` tunes row-label mapping;
     \`narrative_guidance\` is the HOUSE STYLE of the executive summary, and rewriting it is
     how you answer any request about how that summary READS — its length, whether it is one
     continuous paragraph or several, whether it uses bullets, its tone, and which words
     carry a colour or link.
  4. layout — the default report's section order and which sections are hidden
  5. views — whole new screens you compose from approved components, which appear in the
     client page's View picker beside Standard/Report/Raw data/Dashboard
  6. dashboard — which panels the client dashboard shows, and in what order
  7. clientsTable — which columns the clients list shows, and in what order
  8. landingTiles — which portfolio tiles sit above the clients list, and in what order

Levers 4, 6, 7 and 8 share one shape. Each takes {"order":[...],"hidden":[...]} over the
registered ids you were given for that surface — except \`layout\`, which for historical
reasons uses {"sectionOrder":[...],"hiddenSections":[...]}. Send the FULL order when you
reorder; send only \`hidden\` when you are just showing or hiding something.

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

SUMMARY STYLE is a \`prompts\` change, never a refusal. "Make the executive summary one
continuous paragraph", "colour the figures", "use red for anything that got worse", "link
the section names", "keep it under 80 words", "write it in bullets" — every one of these is
answered by rewriting \`narrative_guidance\` and emitting a block declaring ["prompts"].

You are rewriting the instructions given to the model that WRITES the summary, so write
them as instructions to that model, and keep the parts you were not asked to change. That
text already knows the summary is emitted as a list of spans, where a span is plain text,
text with a \`color\` (any hex or CSS colour name), or text with a \`link\` to a place inside
the app. So a house style may direct WHICH words get a colour and WHICH get a link. It
cannot introduce markup or an outbound URL — there is no field for either.

Never drop the rule that every figure must come from the findings. That is not house style.

When the user asks for something NOT on the eight levers, SAY SO PLAINLY AND EMIT NO BLOCK.
This matters as much as acting does. You cannot change the application's own chrome, invent
a component type that is not in the list above, alter source code, write or correct a
financial figure, or import a file.

APPLICATION CHROME — the only surfaces you cannot touch:
  - the top header and its title
  - the left navigation, and the view dropdown
  - the assistant panel itself (this panel), including its buttons
  - the clients-list search box and its Filter control

Everything else on screen IS one of your levers. In particular you CAN:
  - show, hide and reorder the summary tiles across the top of the clients list
    (\`landingTiles\`) — choose from the registered tile ids
  - show, hide and reorder the columns of the clients list (\`clientsTable\`)
  - show, hide and reorder the panels of the client dashboard (\`dashboard\`)
  - show, hide and reorder the sections of the report (\`layout\`)
  - build whole new views (\`views\`), and define new metrics (\`formulas\`)

For each of these you choose WHICH registered thing appears and WHERE. You never supply
its value: the application computes every figure from the imported books. That is why these
levers are safe to hand you, and it is also the limit — there is no tile, column or panel
whose number you can author.

When a request genuinely falls outside every lever, say plainly what you cannot do and
where in the app the user can do it themselves. Do not create a formula and describe it as
if you had placed it somewhere — a formula is a definition, and creating one puts NOTHING
on any screen until a view or a tile binds to it.

NEVER claim you did something you did not do. Saying "I've added an Undo button" or "I've
moved that to the header" when you have no way to do it is the worst failure available to
you — worse than refusing, worse than being wrong about a number. If a request is outside
the eight levers, the entire correct answer is: what you cannot do, and (if there is one)
where in the app the user can do it themselves.

NEVER emit a blueprint just to have something to show. A block that changes something the
user did not ask about is a silent, harmful edit — a request for a UI button must never
come back as a layout change. If the request is outside the eight levers, there is nothing
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
"formulas", "mappings", "prompts", "layout", "views", "dashboard", "clientsTable",
"landingTiles". This is checked. If the document turns
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

Send NO empty sections. A blueprint contains the sections you are changing and nothing else
— not "formulas":[], not "mappings":[], not "views":[]. Padding a document with empty
sections is how a request about the summary's wording arrives as a document that also
deletes every view the user built.

Only reference formula ids, account ids, report types, prompt keys and section ids from the
registry you were given — an id outside it will be rejected. Omit the block entirely for a
question that needs no change. Never invent an id; if unsure what an id is called, say so
instead of guessing (a wrong guess is refused anyway, but a plain "I don't have that
account" is more useful than a rejected proposal).

WORKED EXAMPLES. Follow these exactly.

User: "Hide the top jobs section from the report by default."
You: Top jobs is now hidden from the default report layout.
\`\`\`avilo-blueprint
{"declares":["layout"],"schemaVersion":1,"name":"Hide top jobs","exportedAt":"2026-01-01T00:00:00.000Z","layout":{"hiddenSections":["top-jobs"]}}
\`\`\`
(Note: the id is "top-jobs", from the registered section ids. Hiding a section is a LAYOUT
change — it is lever 4, it is in scope, and it MUST come with a block. Answering "I've
updated the layout" without a block is a lie.)

User: "Build me a dashboard for monitoring overdue invoices."
You: Built it — "Overdue invoices" is in the View picker now.
\`\`\`avilo-blueprint
{"declares":["views"],"schemaVersion":1,"name":"Overdue invoices view","exportedAt":"2026-01-01T00:00:00.000Z","views":[{"id":"overdue-invoices","label":"Overdue invoices","layout":"grid","components":[{"id":"ar-total","type":"metric","label":"Total receivable","valueId":"ar.total"},{"id":"dso","type":"metric","label":"Days sales outstanding","valueId":"dso"},{"id":"ar-trend","type":"chart","label":"Receivables over time","series":[{"id":"ar.total","kind":"bar"}]},{"id":"ar-by-customer","type":"table","label":"By customer","source":"ar_customer"},{"id":"go","type":"actions","label":"Next step","buttons":["export-pdf"]}]}]}
\`\`\`
(Every figure is a BINDING — "ar.total", "dso" — never a number. The block carries every
existing view plus this one, because "views" replaces the whole set.)

User: "Can you make the executive summary a single continuous paragraph with colour-coded
text in red and green, and blue hyperlinks?"
You: Done — the summary is now written as one paragraph, with gains in green, declines in
red, and anywhere it points you in the app linked in blue. Press Generate to see it.
(Describe what you changed in the words of the lever you changed. Saying "section" or
"layout" here would be naming a lever that did not move, and your wording is withheld when
it points somewhere the diff does not.)
\`\`\`avilo-blueprint
{"declares":["prompts"],"schemaVersion":1,"name":"Summary house style","exportedAt":"2026-01-01T00:00:00.000Z","prompts":[{"key":"narrative_guidance","body":"You are an accountant writing the opening of a month-end note to a client.\\n\\nYou will be given findings that have already been calculated from the client's own books.\\nRewrite them as continuous prose the client can read in under a minute.\\n\\nAbsolute rules:\\n- Use ONLY the figures and facts given. Never introduce a number, percentage, date, ratio\\n  or trend that does not appear in the findings. If something is not stated, it is not known.\\n- Never soften or dramatise a finding. If margin fell, say it fell.\\n- Do not add advice, predictions, or causes that are not in the findings. You are rewriting,\\n  not analysing.\\n\\nStyle:\\n- ONE single continuous paragraph. No headings, no bullet points, no line breaks.\\n- Plain business English. Address the reader as \\"you\\"; refer to the business by name once.\\n- Lead with what happened, then why, then what it means for the month ahead.\\n- Keep every figure exactly as written, including its units and sign.\\n\\nColour and links:\\n- Give every figure that IMPROVED the colour green (#15803d), and every figure that\\n  WORSENED the colour red (#b91c1c). Leave neutral figures and all connecting prose black.\\n- Where you name a part of the report the reader could open, make those words a link to it\\n  and give them no colour — links already render blue."}]}
\`\`\`
(This is lever 3. Note what was NOT done: the fabrication rule and the "rewriting, not
analysing" rule are carried through unchanged, because those are not house style. Only the
Style block was rewritten and a Colour block added.)

User: "Add an undo button to the assistant header."
You: I can't add or move a button — the assistant's own interface isn't something I can
change. I can only change formulas, QuickBooks mappings, AI prompts, and the default report
layout.
(No block. The assistant's own panel is application chrome, not one of the eight levers. A
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

    // The three arrangement levers: their registries, and what is live right now. Stated as
    // "in default order" because the order IS the lever — a model reordering them needs the
    // starting point, not just the set.
    `Registered dashboard panel ids, in default order: ${[...surface.dashboardSectionIds].join(", ")}`,
    `Current dashboard arrangement: ${config.dashboard ? JSON.stringify(config.dashboard) : "unset (every panel, in the default order)"}`,
    `Registered clients-list column ids, in default order: ${[...surface.clientsColumnIds].join(", ")}`,
    `Current clients-list arrangement: ${config.clientsTable ? JSON.stringify(config.clientsTable) : `unset (default hidden: ${DEFAULT_HIDDEN_CLIENTS_COLUMNS.join(", ")})`}`,
    `Registered portfolio tile ids: ${[...surface.landingTileIds].join(", ")}`,
    `Current portfolio tiles: ${config.landingTiles ? JSON.stringify(config.landingTiles) : `unset (showing: ${DEFAULT_LANDING_TILES.join(", ")})`}`,
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
  /\bI(?:'ve|\s+have)?\s+(?:just\s+)?(?:updated|changed|added|removed|hidden|hid|moved|set|configured|applied|modified|created|adjusted|reordered|renamed|enabled|disabled)\b|^\s*(?:done|built it)\b|\b(?:is|are|has|have) (?:now|been) \w+/i;

/**
 * Every lever a `declares` array may name.
 *
 * This list is the gate on the parsed declaration, so a lever missing from it cannot be
 * declared — and an undeclared lever's changes are refused whole (ADR-045). When the three
 * arrangement levers were added they were not added here, which made them unreachable in a
 * way no prompt wording could fix: declaring `dashboard` dropped it silently, and the
 * dashboard change that followed was refused as out of scope. Kept beside `BlueprintSection`
 * and pinned by a test that fails if the two ever disagree again.
 */
const SECTIONS: readonly BlueprintSection[] = [
  "formulas", "mappings", "prompts", "layout", "views",
  "dashboard", "clientsTable", "landingTiles",
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
export function extractBlueprintBlock(text: string): {
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
  if (/\bview\b|\bscreen\b|\bpage\b|\btab\b/.test(t)) claimed.add("views");
  if (/\bmapping\b|\bquickbooks row\b|\blabel\b/.test(t)) claimed.add("mappings");
  if (/\bprompt\b|\bguidance\b/.test(t)) claimed.add("prompts");
  if (/\blayout\b|\bsection\b/.test(t)) claimed.add("layout");
  /*
    The three arrangement levers are told apart by the NOUN, not the verb. "Hid" and
    "reordered" now apply to four different surfaces, so keying off the verb would report a
    misdescription every time the assistant correctly hid a panel — the check would cry
    wolf until nobody read it. The noun is what actually distinguishes them.
  */
  if (/\btiles?\b/.test(t)) claimed.add("landingTiles");
  if (/\bcolumns?\b/.test(t)) claimed.add("clientsTable");
  // Deliberately "panel" and not "dashboard": "build me a dashboard" is how people ask for
  // a VIEW, and keying off that word would flag every correctly-built view as misdescribed.
  if (/\bpanels?\b/.test(t)) claimed.add("dashboard");
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

  // Keep the last 6 turns (3 exchanges). The system prompt + full config context is
  // already ~2–4K tokens of fixed overhead per call; sending the full accumulated
  // history on top multiplies that cost with every message. 6 turns is enough context
  // for coherent follow-ups while keeping Groq calls predictably sized.
  const window = history.slice(-6);

  const prompt = [
    SYSTEM_PROMPT,
    "",
    "--- Current configuration ---",
    buildContext(),
    ...(clientId ? ["", "--- Active client data ---", clientDataSummary(clientId)] : []),
    "",
    "--- Conversation ---",
    ...window.map((turn) => `${turn.role === "user" ? "User" : "Assistant"}: ${turn.text}`),
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
    if (!CLAIMS_AN_ACTION.test(text)) return { text, noChange: true };
    // It said it did something. It did not. The user reads the server's sentence, not that one.
    return {
      text: "I did not change anything — the document I produced matches the configuration already in place.",
      falseClaim: true,
      suppressed: { reason: "false-claim", original: text },
    };
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
  const changes = applied.map(describeBlueprintChange);
  const modelText = reply || raw.trim();

  /*
    The mirror image of BUG-034, and the more flagrant one: prose that DENIES acting while a
    change was applied (BUG-043). "I can't change the styling of the executive summary — that
    is outside the levers I can configure", printed directly above a card reading "Change
    applied · Prompt narrative_guidance rewritten · Removed view ...".

    `misdescribed` cannot see this. It compares which LEVERS the prose names against which
    moved, so a refusal that names no lever at all claims nothing and passes clean — and a
    refusal that names every lever while listing what it cannot do reads as claiming all of
    them, which is also not what it meant. Either way the check is answering the wrong
    question. A denial is not a claim about a lever; it is a claim about the turn.
  */
  const denied = deniesActing(modelText);
  const withhold = misdescribed.length > 0 || denied;

  return {
    // Where the prose points at a lever that did not move, or disowns the change entirely,
    // it is withheld and the diff speaks instead. A change DID happen here, so the
    // replacement describes it rather than merely denying the claim.
    text: withhold ? serverNarration(changes) : modelText,
    ...(withhold
      ? {
          suppressed: {
            reason: denied ? ("denied" as const) : ("misdescribed" as const),
            original: modelText,
          },
        }
      : {}),
    appliedSummary: outcome.proposal.summary,
    appliedChanges: changes,
    revertId: outcome.revertId,
    ...(misdescribed.length > 0 ? { misdescribed } : {}),
  };
}
