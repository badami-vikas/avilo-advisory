# AI

**The app works fully with no key.** AI is additive. Nothing breaks without it.

## Where a model is allowed

| Feature | Trigger | What it does |
|---|---|---|
| Suggest | button, upload dialog | maps unmatched row labels → canonical accounts |
| Generate | button, executive summary | rewrites *computed* findings as client-ready prose |
| Test connection | button, model settings | proves key + model work |

**No automatic calls.** Not on upload, render, or navigation. See ADR-015.

## Guards

- **Choose, never invent.** Mapping picks from the account list or `skip`; a hallucinated id degrades to `skip`.
- **No fabricated figures.** Generated prose is checked against the source findings; a draft containing a number the books lack is discarded (`fabricatedFigures`).
- **Deterministic narrative is truth.** `insights.ts` computes the summary; Generate only rewrites it.
- **New data supersedes edits.** An edited summary carries a fingerprint of the findings it was written against; when figures move, it is set aside.

## Config

One key: `groq_api_key` in `app_settings`, read only by `groqConfig()` in `apps/api/src/services/ai.ts`. Never in the binary — verified per release. Models: `llama-3.3-70b-versatile` (default), `llama-3.1-8b-instant`. Mixtral was removed — decommissioned by Groq.

**Prompts are data.** `ACCOUNTING_GUIDANCE` / `NARRATIVE_GUIDANCE` override via `app_settings`, so accuracy is tuned without shipping a binary. That is what a "skill" is for an HTTP model: instructions travelling inside the request.

**Cost lever = persistence, not click-gating.** An accepted mapping is stored and never asked again; cost decays to zero.
