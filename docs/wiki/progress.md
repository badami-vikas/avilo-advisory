# Progress

**v1.9.3** — shipping to a first beta user. macOS ships arm64 only for now (BUG-028). The assistant **acts** on the four things it can configure — formulas, mappings, prompts, default report layout — and refuses everything else out loud. 1.9.2 shipped it claiming to have added UI buttons and silently hiding a report section it was never asked about (BUG-029 to BUG-032); the server now contradicts a claim that does not match what it wrote (ADR-040), and every applied change is described in words the user can check. It also reads the open client's real data, and the report and assistant scroll independently.

## Done

- Multi-client, multi-period fact store; formulas as data; override history
- Right-panel AI chatbot (applies blueprint changes directly, with Undo — see below), same Groq key as row mapping and summaries. Chat history persists across a refresh; a blueprint may now also propose the app-wide default report layout (order/hidden sections), applied as a fallback beneath any client's own saved layout — see `docs/wiki/blueprint.md`
- Import: Excel/CSV/PDF → one grid → six parsers; deterministic classification at 1.0
- Label learning — teach once, never asked again; multi-select, and Undo
- Report view, raw data view, PDF export, interactive dashboard
- Insight engine, warnings, recommendations, 13-week forecast, goal seek
- Shared legend + data toggle on every visual
- AI: row mapping, executive-summary generation, connection test — all button-triggered
- Editable executive summary; new data supersedes the edit
- Desktop installers for macOS (dmg ×2) and Windows (exe, x64)

## First beta round — what came back and what happened

| Reported | Outcome |
|---|---|
| Revenue, gross profit and NOI wrong | **Fixed** (BUG-017) — one section total now wins, siblings sum |
| Days cash on hand read 10,304 | **Fixed** (BUG-018) — month's spend was divided by 365 |
| Top expenses showed two rows, one a negative rebate | **Fixed** (BUG-019) — section closed at the first sub-group total |
| A/R ageing listed job codes and subtotals | **Fixed** (BUG-020) — groups collapse to one row per customer |
| Top customers / referral partners not populating | **Fixed** (BUG-021) — label column was reading a month column |
| No way to undo a mapping | **Fixed** (BUG-022) |
| Mapping many rows one at a time | **Fixed** — tick several, map together |
| Unclear that mappings persist to next month | **Fixed** — the copy now says so |
| Install/uninstall messy on Windows | **Addressed** — see below; unverified on Windows |
| Define service lines for "Where your money came from" | **Not done** — a feature, not a fix. Today it splits the P&L income section |
| Job counts per customer | **Not done** — the export has no count column, and inferring one is what v9 got wrong repeatedly |

## Open

| Item | Priority |
|---|---|
| Windows installer never launched on Windows by us | **high** |
| Installer unsigned — SmartScreen warns | high before wider release |
| Groq key stored plain text (BUG-014) | accepted for local beta |
| No CSP on loopback server (BUG-013) | low while local-only |
| Two stray empty client rows (BUG-012) | low |
| Service-line mapping for revenue/COGS | feature request |
| No referral report in the reference set — `ops.referral_total` never populates | **blocked on data** |
| Transaction Detail by Account misclassifies (BUG-024) | medium |
| Only one balance sheet — every balance-sheet metric is a single point | **blocked on data** |
| Point-in-time metric twins exist but the KPI drill-down does not surface them | medium |
| 13-week forecast runs on P&L run rate, not on A/R and A/P timing | **high** |

## Windows install and uninstall

Three changes in 1.6.0, none of them verified on Windows by us:

- **One installer, x64 only.** Two architectures meant two near-identically named files and no way for the person downloading to tell which their machine wanted. Windows on ARM runs x64 under emulation.
- **`build/installer.nsh`** ends a running copy on install and uninstall rather than asking the user to close a window that may not exist. The hung-process state it exists for was real in v1.4.x — the server's `close()` drained open connections forever, so the process outlived its last window. That is separately fixed by the bounded 2.5s quit in `apps/desktop/src/main.ts`.
- **`artifactName` carries the version**, so "is this the current build" is answerable without opening it.

"Installer integrity check has failed" is almost always corruption in transit. Our exe is self-consistent — its SHA-512 matches `latest.yml`. Have the user re-download and compare `certutil -hashfile <exe> SHA256`.

## Verification budget

300 tests (168 domain + 44 API + 63 web + 17 core, up from 297 in 1.9.2 for the empty-diff guard and the false-claim detector) · 7 packages typecheck · parsers validated against the real client exports in `reference/Reporting data`, asserting against each report's own printed totals rather than against a row count.

The 1.9.3 assistant was verified live against the real database, in one session, both ways: "I want the undo button on header of avilo assistant" is refused with nothing written (no layout row, no proposal), and "Hide the top jobs section" applies, shows "Report layout — hid top-jobs", and undoes. In between, the model was caught claiming a layout change it had not made — the red "Nothing was actually changed" correction is a screenshot of the real failure, not a mock. That round-trip is what produced ADR-039 and ADR-040.
