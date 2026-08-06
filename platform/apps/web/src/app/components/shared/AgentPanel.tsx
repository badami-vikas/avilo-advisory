/**
 * AI chat — persistent right panel, mounted in <Shell>: `AgentPanelHeader` inside the
 * shared top header (so "Avilo Advisory" and "Avilo Assistant" sit on the same line, at
 * the same height — one header element, not two stacked ones), `AgentPanelBody` beside
 * the main content Outlet, below it.
 *
 * Path and shape deliberately match `relationship-os/platform/apps/web/src/app/
 * components/shared/AgentPanel.tsx`: same location in the tree, same collapse/expand
 * fixed-width panel, same "every reply is real, a routed action is a real proposal,
 * never fabricated feed content" principle. Avilo has no Chief of Staff or Approvals, so
 * this talks to `copilot.converse` instead of `chiefOfStaff.converse`, and a routed
 * action is a `blueprint_proposals` row instead of an Approvals entry — narrower, same
 * shape. On integration this file and `blueprint.ts` move to relationship-os and this
 * copy is deleted, same as `platform/packages/tables` is described as doing.
 *
 * No `re-resizable`/`motion` dependency here either, for the same reason the upstream
 * file gives: collapse/expand with a CSS transition, not a drag-resizable panel.
 */
import { useEffect, useRef, useState } from "react";
import { ChevronsLeft, ChevronsRight, History, Sparkles } from "lucide-react";
import { api } from "../../../lib/trpc.js";
import { Button } from "../ui.js";
import { ConfigurationHistoryDialog } from "../ConfigurationHistoryDialog.js";

interface ChatTurn {
  role: "user" | "assistant";
  text: string;
  appliedSummary?: string;
  appliedChanges?: string[];
  revertId?: string;
  noChange?: true;
  falseClaim?: true;
  outOfScope?: { declared: string[]; undeclared: string[]; changes: string[] };
  misdescribed?: string[];
  suppressed?: { reason: "false-claim" | "misdescribed" | "denied"; original: string };
  proposalErrors?: { path: string; message: string }[];
}

/**
 * What the assistant just did, and the way back.
 *
 * The change is already live by the time this renders — the assistant acts rather than
 * asking. Undo activates the snapshot proposal the server took immediately before applying,
 * which is an ordinary `blueprint.activate` call: the reversal is itself a recorded,
 * auditable configuration change, not a hidden rollback.
 */
function AppliedCard({
  summary,
  changes,
  revertId,
  reverted,
  onReverted,
}: {
  summary: string;
  changes: string[];
  revertId: string;
  reverted: boolean;
  onReverted: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const undo = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.blueprint.activate.mutate({ id: revertId });
      onReverted(revertId);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 rounded-lg border border-accent/30 bg-accent-soft/40 p-2.5">
      <p className="flex items-center gap-1.5 text-[11.5px] font-medium text-ink">
        <Sparkles size={12} className="text-accent" />
        {reverted ? "Change undone" : "Change applied"}
      </p>
      <p className="mt-1 text-[11.5px] leading-relaxed text-ink-muted">{summary}</p>
      {changes.length > 0 ? (
        <ul className="mt-1 space-y-0.5 text-[11px] text-ink-faint">
          {changes.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      ) : null}
      {error ? <p className="mt-1.5 text-[11px] text-flag">{error}</p> : null}
      {reverted ? null : (
        <div className="mt-2">
          <Button size="sm" onClick={() => void undo()} disabled={busy}>
            {busy ? "Undoing…" : "Undo"}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Same key on both `settings.get`/`settings.set` — the generic app_settings reader every
 * other runtime override in this app already goes through (ADR-013's one existing
 * override path, reused rather than a new table). Chat history is not a blueprint: it
 * never goes through `validateBlueprint`, because a stored turn is just text, never
 * something the app treats as a proposed change until the model re-emits it.
 */
const CHAT_HISTORY_KEY = "copilot_chat_history";

interface StoredChat {
  turns: ChatTurn[];
  decided: Record<string, "reverted">;
}

/**
 * The panel's title and collapse toggle, rendered by `<Shell>` inside its own top
 * header — not inside `<aside>` below. That is what puts "Avilo Advisory" and "Avilo
 * Assistant" on the same line, at the same height: one `<header>` element, not two
 * stacked ones. `AgentPanelBody` below owns the actual conversation and stays mounted
 * (just width-collapsed) whether or not this reads as expanded, so chat state and its
 * restore-on-mount effect are never lost by toggling.
 */
export function AgentPanelHeader({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className={`no-print flex flex-shrink-0 items-center border-l border-line ${
        collapsed ? "w-10 justify-center" : "w-[320px] justify-between px-3"
      }`}
    >
      {collapsed ? null : (
        <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink">
          <Sparkles size={13} className="text-accent" />
          Avilo Assistant
        </span>
      )}
      <button
        onClick={onToggle}
        aria-label={collapsed ? "Open AI chat" : "Collapse AI chat"}
        className="rounded p-1 text-ink-faint hover:bg-line-soft hover:text-ink"
      >
        {collapsed ? <ChevronsLeft size={14} /> : <ChevronsRight size={14} />}
      </button>
    </div>
  );
}

export function AgentPanelBody({ collapsed, clientId }: { collapsed: boolean; clientId?: string }) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [decided, setDecided] = useState<Record<string, "reverted">>({});
  const [loaded, setLoaded] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns]);

  // Restore on mount. Gated by `loaded` below so this read never gets clobbered by the
  // save effect firing first on an empty initial state.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const row = await api.settings.get.query({ key: CHAT_HISTORY_KEY });
        if (cancelled) return;
        if (row) {
          const saved = JSON.parse(row.value) as StoredChat;
          setTurns(saved.turns ?? []);
          setDecided(saved.decided ?? {});
        }
      } catch {
        // No history, or a corrupt row from an older shape — start fresh rather than
        // block the panel from opening.
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist after the initial load, and on every turn/decision change after that.
  useEffect(() => {
    if (!loaded) return;
    const value = JSON.stringify({ turns, decided } satisfies StoredChat);
    void api.settings.set.mutate({ key: CHAT_HISTORY_KEY, value }).catch(() => {
      // A failed save must not surface as a chat error — the conversation itself still
      // worked; only its persistence across a refresh is at risk.
    });
  }, [loaded, turns, decided]);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setDraft("");
    setError(null);
    const next: ChatTurn[] = [...turns, { role: "user", text }];
    setTurns(next);
    setSending(true);
    try {
      const reply = await api.copilot.converse.mutate({
        history: next.map((t) => ({ role: t.role, text: t.text })),
        clientId,
      });
      /*
        A change the assistant just made should be visible without a reload — a new view in
        the picker, a reordered report. The page reads its configuration on mount and on
        window focus, and neither fires here, so say so explicitly.
      */
      if (reply.revertId) window.dispatchEvent(new Event("avilo:configuration-changed"));

      setTurns((current) => [
        ...current,
        {
          role: "assistant",
          text: reply.text,
          appliedSummary: reply.appliedSummary,
          appliedChanges: reply.appliedChanges,
          revertId: reply.revertId,
          noChange: reply.noChange,
          falseClaim: reply.falseClaim,
          outOfScope: reply.outOfScope,
          misdescribed: reply.misdescribed,
          suppressed: reply.suppressed,
          proposalErrors: reply.proposalErrors,
        },
      ]);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <aside
      className={`no-print flex flex-shrink-0 flex-col overflow-hidden border-l border-line bg-surface ${
        collapsed ? "w-0 border-l-0" : "w-[320px]"
      }`}
    >
      <div className="flex h-full w-[320px] flex-shrink-0 flex-col">
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3">
        {turns.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line p-3 text-[11.5px] leading-relaxed text-ink-muted">
            Ask how a figure is computed, or ask for a change to a formula, a QuickBooks
            mapping, or an AI prompt. A proposed change is recorded here for you to apply
            or dismiss — nothing changes until you say so.
            {clientId ? (
              <>
                {" "}
                With a client open, it can also see that client's imported periods and
                which accounts have no data.
              </>
            ) : null}
          </div>
        ) : null}

        {turns.map((turn, i) => (
          <div key={i} className={`mb-3 ${turn.role === "user" ? "text-right" : ""}`}>
            <div
              className={`inline-block max-w-[90%] rounded-lg px-2.5 py-1.5 text-left text-[12px] leading-relaxed ${
                turn.role === "user"
                  ? "bg-ink text-white"
                  : "border border-line bg-canvas text-ink"
              }`}
            >
              {turn.text}
            </div>
            {/*
              The withheld wording. Shown collapsed rather than not at all: the point is
              that the user does not READ the false sentence by default, not that it becomes
              unavailable to someone debugging their assistant.
            */}
            {turn.suppressed ? (
              <details className="mt-1.5 text-[11px] text-ink-faint">
                <summary className="cursor-pointer select-none">
                  {turn.suppressed.reason === "false-claim"
                    ? "The assistant's own wording claimed a change that was not made — withheld."
                    : "The assistant's own wording described a different change — withheld."}
                </summary>
                <p className="mt-1 rounded-lg border border-line bg-canvas p-2 leading-relaxed">
                  {turn.suppressed.original}
                </p>
              </details>
            ) : null}
            {turn.falseClaim ? (
              <div className="mt-2 rounded-lg border border-flag/40 bg-flag/5 p-2.5 text-[11.5px] leading-relaxed text-flag">
                <span className="font-medium">Nothing was changed.</span> The assistant can
                change formulas, QuickBooks mappings, AI prompts, the report layout, the
                dashboard panels, the clients-list columns and tiles, and it can build views
                — never the app&rsquo;s header, navigation or figures.
              </div>
            ) : null}
            {turn.outOfScope ? (
              <div className="mt-2 rounded-lg border border-flag/40 bg-flag/5 p-2.5 text-[11.5px] leading-relaxed text-flag">
                <span className="font-medium">Refused — nothing was changed.</span> The
                assistant said it was changing{" "}
                {turn.outOfScope.declared.length > 0
                  ? turn.outOfScope.declared.join(", ")
                  : "nothing"}
                , but the change it produced would also have altered{" "}
                {turn.outOfScope.undeclared.join(", ")}:
                <ul className="mt-1 space-y-0.5">
                  {turn.outOfScope.changes.map((c, j) => (
                    <li key={j}>· {c}</li>
                  ))}
                </ul>
                <p className="mt-1">
                  Nothing was written. Ask again and it will have to be explicit about what
                  it touches.
                </p>
              </div>
            ) : null}
            {/*
              No longer says "trust the list, not the sentence above" — the sentence above
              IS the list now, generated from the diff. This records why the swap happened.
            */}
            {turn.misdescribed?.length ? (
              <p className="mt-1.5 rounded-lg border border-flag/30 bg-flag/5 p-2 text-[11px] leading-relaxed text-flag">
                The assistant described a change to{" "}
                <span className="font-medium">{turn.misdescribed.join(", ")}</span>, which is
                not what it did. The summary above is the server&rsquo;s, taken from the
                change list.
              </p>
            ) : null}
            {turn.noChange ? (
              <p className="mt-1.5 text-[11px] text-ink-faint">
                No configuration change was made.
              </p>
            ) : null}
            {turn.revertId ? (
              <AppliedCard
                summary={turn.appliedSummary ?? ""}
                changes={turn.appliedChanges ?? []}
                revertId={turn.revertId}
                reverted={decided[turn.revertId] === "reverted"}
                onReverted={(id) =>
                  setDecided((current) => ({ ...current, [id]: "reverted" }))
                }
              />
            ) : null}
            {turn.proposalErrors?.length ? (
              <div className="mt-1.5 rounded-lg border border-flag/30 bg-flag/5 p-2 text-[11px] text-flag">
                {turn.proposalErrors.map((e, j) => (
                  <p key={j}>
                    {e.path}: {e.message}
                  </p>
                ))}
              </div>
            ) : null}
          </div>
        ))}

        {sending ? (
          <p className="text-[11.5px] text-ink-faint">Thinking…</p>
        ) : null}
      </div>

      {error ? (
        <p className="border-t border-line px-3 py-2 text-[11px] text-flag">{error}</p>
      ) : null}

      <div className="border-t border-line p-2.5">
        <div className="mb-1.5 flex justify-end">
          <button
            onClick={() => setHistoryOpen(true)}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-ink-faint hover:bg-line-soft hover:text-ink"
          >
            <History size={11} />
            History
          </button>
        </div>
        <div className="flex items-end gap-1.5">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            placeholder="Ask a question, or propose a change…"
            rows={2}
            className="min-h-0 flex-1 resize-none rounded-md border border-line bg-canvas px-2 py-1.5 text-[12px] outline-none focus:border-accent"
          />
          <Button variant="primary" size="sm" onClick={() => void send()} disabled={sending || !draft.trim()}>
            Send
          </Button>
        </div>
      </div>
      </div>
      {historyOpen ? <ConfigurationHistoryDialog onClose={() => setHistoryOpen(false)} /> : null}
    </aside>
  );
}
