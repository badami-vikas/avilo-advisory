import { useEffect, useState } from "react";
import { Eye, EyeOff, X } from "lucide-react";
import { api } from "../../lib/trpc.js";
import { Button } from "./ui.js";

const GROQ_MODELS = [
  { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B (recommended)" },
  { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B (fastest)" },
  { id: "mixtral-8x7b-32768", label: "Mixtral 8x7B" },
];

export function ModelSettingsDialog({ onClose }: { onClose: () => void }) {
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("llama-3.3-70b-versatile");
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void Promise.all([
      api.settings.get.query({ key: "groq_api_key" }),
      api.settings.get.query({ key: "groq_model" }),
    ]).then(([keyRow, modelRow]) => {
      if (keyRow?.value) setApiKey(keyRow.value);
      if (modelRow?.value) setModel(modelRow.value);
    });
  }, []);

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
              Get a free key at console.groq.com. Leave blank to use rule-based classification only.
            </p>
          </div>
        </div>

        <footer className="flex justify-end gap-2 border-t border-line px-5 py-3.5">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={saving}>
            {saved ? "Saved" : saving ? "Saving…" : "Save"}
          </Button>
        </footer>
      </div>
    </div>
  );
}
