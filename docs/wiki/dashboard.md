# Interactive dashboard

Same numbers as the report, different question. Report = "what do I send the client". Dashboard = "what is going on, and what should we do".

## Insight engine

`insights.ts` — ~1,300 lines of **pure functions** over the period report, series and detail rows. No model, no network.

- Narrative beats are assembled from measured facts and branch on real movement — `revenue.direction === "up" ? "A bigger month" : …`
- Every derived figure carries whether it could be computed, and why not if not.
- Components ask this file questions; they never invent thresholds.

## Charts

Shared `Frame` for all six types. One HTML `Legend`, never chart.js's. Same verb everywhere: nothing selected = draw everything, select = isolate, select again = restore. **Exception:** the ageing doughnut dims rather than isolating — remove a slice and the ring stops being a share of anything.

**Data toggle** on every visual — each chart hands `Frame` its own rows (ADR-022).

## Executive summary

Three states:

1. **Calculated** (default) — from `insights.ts`.
2. **Generated** — AI rewrite of those findings, guarded against fabricated figures. Never persisted.
3. **Your wording** — double-click to edit. Stored with a fingerprint; **new figures always supersede it** (ADR-019).

## One date, many windows

The month picker anchors the page. Each panel states its own look-back, because a P&L is a month, a balance is a day, a customer ranking is a year — they cannot share a window, but they share an **end** (ADR-021).
