import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Eye, EyeOff, X } from "lucide-react";
import { api } from "../../lib/trpc.js";
import { Button } from "./ui.js";

/*
  Only models currently served by Groq.

  "mixtral-8x7b-32768" was offered here until it turned out to be decommissioned — the
  API rejects it outright. Nothing surfaced that, because classification only consults a
  model for files the rules cannot place, so the dead model sat unused and silent. Hence
  the Test button below: a configuration you cannot exercise is a configuration you
  cannot trust.
*/
const GROQ_MODELS = [
  { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B — best accuracy" },
  { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B — fastest" },
];

export function ModelSettingsDialog({ onClose }: { onClose: () => void }) {
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("llama-3.3-70b-versatile");
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    void Promise.all([
      api.settings.get.query({ key: "groq_api_key" }),
      api.settings.get.query({ key: "groq_model" }),
    ]).then(([keyRow, modelRow]) => {
      if (keyRow?.value) setApiKey(keyRow.value);
      if (modelRow?.value) setModel(modelRow.value);
    });
  }, []);

  /**
   * Exercise the configuration against the real endpoint.
   *
   * Tests what is typed rather than what is stored, so a key can be verified before it
   * is committed — and a bad one never gets saved in the first place.
   */
  const runTest = async () => {
    setTesting(true);
    setTest(null);
    try {
      const result = await api.settings.testConnection.mutate({
        apiKey: apiKey.trim() || undefined,
        model,
      });
      setTest({ ok: result.ok, message: result.message });
    } catch (cause) {
      setTest({ ok: false, message: (cause as Error).message });
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      if (apiKey.trim()) {
        await api.settings.set.mutate({ key: "groq_api_key", value: apiKey.trim() });
        await api.settings.set.mutate({ key: "groq_model", value: model });
      } else {
        await api.settings.delete.mutate({ key: "groq_api_key" });
      }
      setSaved(true);
      setTimeout(onClose, 800);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/25 p-6 backdrop-blur-[2px]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Model settings"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-line bg-surface shadow-xl"
      >
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight text-ink">Model settings</h2>
            <p className="mt-0.5 text-[12.5px] text-ink-muted">
              Used when file classification needs a nudge. Key stays on your machine.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1 text-ink-muted hover:bg-line-soft hover:text-ink"
          >
            <X size={17} />
          </button>
        </header>

        <div className="space-y-4 px-5 py-4">
          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-ink">
              Provider
            </label>
            <div className="flex h-9 items-center rounded-lg border border-line bg-canvas px-3 text-[13px] text-ink-muted">
              Groq (free tier · fast inference)
            </div>
          </div>

          <div>
            <label htmlFor="groq-model" className="mb-1.5 block text-[12px] font-medium text-ink">
              Model
            </label>
            <select
              id="groq-model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="h-9 w-full rounded-lg border border-line bg-surface px-2.5 text-[13px] text-ink outline-none focus:border-accent"
            >
              {GROQ_MODELS.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="groq-key" className="mb-1.5 block text-[12px] font-medium text-ink">
              Groq API key
            </label>
            <div className="relative">
              <input
                id="groq-key"
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="gsk_…"
                className="h-9 w-full rounded-lg border border-line bg-surface px-3 pr-9 text-[13px] text-ink outline-none focus:border-accent"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink"
                aria-label={showKey ? "Hide key" : "Show key"}
              >
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <p className="mt-1 text-[11.5px] text-ink-faint">
              Get a free key at console.groq.com. Leave blank to work entirely offline —
              every figure still imports, unmatched rows just stay manual.
            </p>
          </div>

          {test ? (
            <p
              className={`flex items-start gap-1.5 rounded-lg border px-3 py-2 text-[12px] leading-relaxed ${
                test.ok
                  ? "border-positive/25 bg-positive/5 text-positive"
                  : "border-flag/25 bg-flag-soft text-flag"
              }`}
            >
              {test.ok ? (
                <CheckCircle2 size={13} className="mt-0.5 shrink-0" />
              ) : (
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              )}
              {test.message}
            </p>
          ) : null}
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-line px-5 py-3.5">
          <Button onClick={runTest} disabled={testing || !apiKey.trim()}>
            {testing ? "Testing…" : "Test connection"}
          </Button>
          <div className="flex gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={save} disabled={saving}>
              {saved ? "Saved" : saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}
