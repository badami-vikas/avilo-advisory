// Override precedence.
//
// Locked semantics:
//   * An override persists indefinitely across sessions.
//   * It is cleared only by a re-import supplying a new value for the SAME
//     (client, period, target).
//   * "Cleared" means moved to status 'superseded', never deleted — the value and the
//     reason survive, and restoring is one click.
//   * An override on a value never mutates the formula that would otherwise produce it.
//
// This module is pure: it decides what *should* happen. Persisting the decision is the
// caller's job, which keeps the rule testable without a database.

export type OverrideStatus = "active" | "superseded" | "restored";

export interface OverrideRecord {
  id: string;
  clientId: string;
  period: string;
  targetKind: "account" | "metric";
  targetId: string;
  value: number;
  status: OverrideStatus;
}

export interface IncomingFact {
  period: string;
  accountId: string;
  value: number;
}

export type ResolutionAction =
  | { kind: "write_fact"; period: string; accountId: string; value: number }
  | {
      kind: "supersede_override";
      overrideId: string;
      supersededValue: number;
      reason: string;
    };

export interface ImportResolution {
  actions: ResolutionAction[];
  /** Human-readable notes for the import summary screen. */
  notices: string[];
}

function keyOf(period: string, targetId: string): string {
  return `${period}|${targetId}`;
}

/**
 * Decide what an import should do in the presence of existing overrides.
 *
 * The fact is always written — provenance is preserved regardless — and any active
 * override on the same target is superseded so the fresh figure becomes the displayed
 * value.
 */
export function resolveImport(
  incoming: IncomingFact[],
  activeOverrides: OverrideRecord[],
): ImportResolution {
  const actions: ResolutionAction[] = [];
  const notices: string[] = [];

  const overrideIndex = new Map<string, OverrideRecord>();
  for (const override of activeOverrides) {
    if (override.status !== "active") continue;
    if (override.targetKind !== "account") continue;
    overrideIndex.set(keyOf(override.period, override.targetId), override);
  }

  for (const fact of incoming) {
    actions.push({
      kind: "write_fact",
      period: fact.period,
      accountId: fact.accountId,
      value: fact.value,
    });

    const existing = overrideIndex.get(keyOf(fact.period, fact.accountId));
    if (!existing) continue;

    if (existing.value === fact.value) {
      // The import agrees with the manual correction. Leave the override in place;
      // superseding it would be churn with no visible effect.
      continue;
    }

    actions.push({
      kind: "supersede_override",
      overrideId: existing.id,
      supersededValue: fact.value,
      reason: "Replaced by a newer imported value",
    });
    notices.push(
      `${fact.accountId} for ${fact.period}: your manual value ${existing.value} was replaced by the imported value ${fact.value}. The previous entry is kept in history and can be restored.`,
    );
  }

  return { actions, notices };
}

/**
 * The value to display for one target, applying precedence.
 * An active override wins over a fact; otherwise the fact stands.
 */
export interface DisplayValue {
  value: number | null;
  source: "override" | "fact" | "missing";
  /** Set when an override is displayed and an underlying fact also exists. */
  divergesFrom?: number;
}

export function displayValue(
  fact: number | undefined,
  override: OverrideRecord | undefined,
): DisplayValue {
  if (override && override.status === "active") {
    return fact === undefined
      ? { value: override.value, source: "override" }
      : override.value === fact
        ? { value: override.value, source: "override" }
        : { value: override.value, source: "override", divergesFrom: fact };
  }
  if (fact === undefined) return { value: null, source: "missing" };
  return { value: fact, source: "fact" };
}
