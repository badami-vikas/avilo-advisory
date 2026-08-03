# Progress

**v1.4.0** — shipping to a first beta user.

## Done

- Multi-client, multi-period fact store; formulas as data; override history
- Import: Excel/CSV/PDF → one grid → six parsers; deterministic classification at 1.0
- Label learning — teach once, never asked again
- Report view, raw data view, PDF export, interactive dashboard
- Insight engine, warnings, recommendations, 13-week forecast, goal seek
- Shared legend + data toggle on every visual
- AI: row mapping, executive-summary generation, connection test — all button-triggered
- Editable executive summary; new data supersedes the edit
- Desktop installers for macOS (dmg ×2) and Windows (exe)

## Open

| Item | Priority |
|---|---|
| Windows installer never launched on Windows | **high before beta** |
| Installer unsigned — SmartScreen warns | high before wider release |
| Groq key stored plain text (BUG-014) | accepted for local beta |
| No CSP on loopback server (BUG-013) | low while local-only |
| Two stray empty client rows (BUG-012) | low |
| Generate button only on executive summary | by design; extend if wanted |

## Verification budget

230 tests (150 domain + 25 API + 55 web) · 6 packages typecheck · smoke test on the packaged app.
