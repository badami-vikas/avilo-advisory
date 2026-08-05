# Progress

**v1.9.2** — shipping to a first beta user. macOS ships arm64 only for now (BUG-028). The assistant now **acts**: it applies a configuration change itself and offers Undo, instead of describing a proposal someone else has to approve (ADR-038). It also reads the open client's real data — imported periods, missing required accounts, accounts that never received a fact — so "what is missing for this client" is answered from the books rather than guessed. The report and the assistant scroll independently.

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

297 tests (168 domain + 41 API + 63 web + 17 core, up from 294 in 1.9.1 for direct blueprint apply, its refuse-and-write-nothing path, and the layout-undo regression) · 7 packages typecheck · parsers validated against the real client exports in `reference/Reporting data`, asserting against each report's own printed totals rather than against a row count.

The 1.9.2 assistant changes were verified live against the real database, not only by unit test: asked "what data points are missing for the active client?" on Phoenix Restoration Co. it named the client, its 12 imported periods, and the three canonical accounts that have never received a fact (`pl.other_income`, `pl.other_expense`, `bs.net_income`) — where the same question in 1.9.1 returned a generic list. Asked to hide a report section it applied the change (confirmed in `app_settings.report_layout_default`), and Undo restored the previous layout (confirmed in the same row). That round-trip is what caught ADR-039.
