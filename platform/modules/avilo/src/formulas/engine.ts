// Formula engine.
//
// Responsibilities, in order of importance:
//   1. Extract each formula's dependencies from its AST — never from a hand-maintained
//      list. This is what guarantees the required-data checklist can never drift from
//      what the dashboard actually renders.
//   2. Topologically order formulas and reject cycles before evaluation.
//   3. Evaluate against a resolved scope of facts and overrides, reporting *why* a value
//      is unavailable rather than silently yielding NaN or 0.
//
// mathjs (Apache-2.0) is the parser/evaluator. HyperFormula was rejected: it is
// GPL-3.0-only and would virally licence this module.

import { create, all, type MathNode } from "mathjs";

// mathjs types `all` as possibly-undefined; it is always populated at runtime.
const math = create(all as Parameters<typeof create>[0], {});

/**
 * Function allowlist for user-authored expressions.
 *
 * Blocking by AST inspection rather than by overriding names on the mathjs instance:
 * mathjs's documented escape hatches (`import`, `createUnit`, `evaluate`, `parse`,
 * `simplify`) can be disabled by re-importing stubs, but that also disables the engine's
 * own use of `parse`. Checking callees on the parsed tree is both stricter — an
 * unrecognised function is refused rather than merely shadowed — and side-effect free.
 */
const ALLOWED_FUNCTIONS = new Set([
  "abs", "ceil", "floor", "round", "fix",
  "min", "max", "sum", "mean", "median",
  "sqrt", "cbrt", "pow", "exp", "log", "log10", "log2",
  "sign", "hypot",
  "number", "unaryMinus", "add", "subtract", "multiply", "divide", "mod",
  "smaller", "larger", "equal", "unequal", "smallerEq", "largerEq",
]);

export class UnsafeExpressionError extends Error {}

/** Reject any call to a function outside the allowlist. */
function assertSafeCallees(root: MathNode, expression: string): void {
  root.traverse((node: MathNode) => {
    const anyNode = node as unknown as Record<string, any>;
    if (anyNode.type !== "FunctionNode") return;
    const name: string =
      typeof anyNode.fn === "string" ? anyNode.fn : (anyNode.fn?.name ?? "");
    if (!ALLOWED_FUNCTIONS.has(name)) {
      throw new UnsafeExpressionError(
        `Function "${name}" is not permitted in formula expressions (in "${expression}")`,
      );
    }
  });

  root.traverse((node: MathNode) => {
    const anyNode = node as unknown as Record<string, any>;
    if (anyNode.type === "AssignmentNode" || anyNode.type === "FunctionAssignmentNode") {
      throw new UnsafeExpressionError(
        `Assignment is not permitted in formula expressions (in "${expression}")`,
      );
    }
  });
}

/**
 * Parse once, validate callees, and hand back the tree for both dependency extraction
 * and evaluation. Trees are cached by expression text: a dashboard evaluates the same
 * handful of expressions across every period of a financial year.
 */
const parseCache = new Map<string, MathNode>();

function parseChecked(expression: string): MathNode {
  const cached = parseCache.get(expression);
  if (cached) return cached;

  let root: MathNode;
  try {
    root = math.parse(expression);
  } catch (cause) {
    throw new Error(
      `Cannot parse expression "${expression}": ${(cause as Error).message}`,
    );
  }
  assertSafeCallees(root, expression);
  parseCache.set(expression, root);
  return root;
}

export interface FormulaSpec {
  id: string;
  label: string;
  expression: string;
  unit?: string;
  active?: boolean;
}

export type ValueSource = "fact" | "override" | "computed";

export interface ResolvedValue {
  value: number;
  source: ValueSource;
  /** Present when source === 'override' and a fact also exists. */
  divergesFrom?: number;
}

/** Inputs available for one (client, period). */
export interface EvaluationScope {
  /** accountId -> resolved value */
  accounts: Map<string, ResolvedValue>;
  /** formulaId -> override, when the user has overridden a computed metric */
  metricOverrides?: Map<string, ResolvedValue>;
}

export type MetricStatus = "ok" | "missing_inputs" | "error";

export interface MetricResult {
  id: string;
  label: string;
  status: MetricStatus;
  value: number | null;
  source: ValueSource | null;
  /** Dependency ids that had no value. Drives the red highlighting. */
  missing: string[];
  /** All dependency ids, direct and transitive through other formulas. */
  dependsOn: string[];
  error?: string;
}

/* ---------------------------------------------------------------- parsing */

const RESERVED = new Set([
  "true", "false", "null", "undefined", "Infinity", "NaN",
  "e", "pi", "PI", "E", "i", "phi", "tau",
]);

/**
 * Collect free symbols from an expression's AST.
 *
 * mathjs represents `pl.revenue` as an AccessorNode over a SymbolNode (`pl`) with an
 * index of `revenue`, so dotted account ids are reassembled here rather than read off
 * SymbolNodes directly.
 */
export function extractDependencies(expression: string): string[] {
  return dependenciesOf(parseChecked(expression));
}

function dependenciesOf(root: MathNode): string[] {
  const found = new Set<string>();

  const dottedPath = (node: MathNode): string | null => {
    // AccessorNode { object, index: IndexNode { dimensions: [ConstantNode] } }
    const anyNode = node as unknown as Record<string, any>;
    if (anyNode.type === "SymbolNode") return anyNode.name as string;
    if (anyNode.type === "AccessorNode") {
      const base = dottedPath(anyNode.object as MathNode);
      const dims = anyNode.index?.dimensions ?? [];
      if (base && dims.length === 1 && dims[0]?.type === "ConstantNode") {
        return `${base}.${String(dims[0].value)}`;
      }
      return base;
    }
    return null;
  };

  root.traverse((node: MathNode, _path, parent: MathNode | null) => {
    const anyNode = node as unknown as Record<string, any>;
    const anyParent = parent as unknown as Record<string, any> | null;

    if (anyNode.type === "AccessorNode") {
      // Skip if this accessor is itself the object of an outer accessor; the outer
      // traversal will capture the full path.
      if (anyParent?.type === "AccessorNode" && anyParent.object === node) return;
      const path = dottedPath(node);
      if (path && !RESERVED.has(path)) found.add(path);
      return;
    }

    if (anyNode.type === "SymbolNode") {
      // Ignore function names: f(x) puts the callee in FunctionNode.fn.
      if (anyParent?.type === "FunctionNode" && anyParent.fn === node) return;
      // Ignore symbols that are part of an accessor path; handled above.
      if (anyParent?.type === "AccessorNode" && anyParent.object === node) return;
      const name = anyNode.name as string;
      if (!RESERVED.has(name)) found.add(name);
    }
  });

  return [...found].sort();
}

/* ------------------------------------------------------------ topological */

export interface DependencyGraph {
  order: string[];
  deps: Map<string, string[]>;
}

/**
 * Order formulas so every formula is evaluated after the formulas it references.
 * Throws on a cycle, naming the members — a formula edit that creates a cycle must be
 * rejected at save time, not discovered as a stack overflow at render time.
 */
export function buildDependencyGraph(formulas: FormulaSpec[]): DependencyGraph {
  const deps = new Map<string, string[]>();
  const ids = new Set(formulas.map((f) => f.id));

  for (const formula of formulas) {
    deps.set(formula.id, extractDependencies(formula.expression));
  }

  const order: string[] = [];
  const state = new Map<string, "visiting" | "done">();
  const stack: string[] = [];

  const visit = (id: string): void => {
    const current = state.get(id);
    if (current === "done") return;
    if (current === "visiting") {
      const cycleStart = stack.indexOf(id);
      const cycle = [...stack.slice(cycleStart), id].join(" → ");
      throw new Error(`Circular formula reference: ${cycle}`);
    }
    state.set(id, "visiting");
    stack.push(id);
    for (const dep of deps.get(id) ?? []) {
      if (ids.has(dep)) visit(dep);
    }
    stack.pop();
    state.set(id, "done");
    order.push(id);
  };

  for (const formula of formulas) visit(formula.id);

  return { order, deps };
}

/** Full transitive dependency set, expanded through other formulas down to accounts. */
export function transitiveDependencies(
  id: string,
  deps: Map<string, string[]>,
): string[] {
  const seen = new Set<string>();
  const walk = (current: string): void => {
    for (const dep of deps.get(current) ?? []) {
      if (seen.has(dep)) continue;
      seen.add(dep);
      if (deps.has(dep)) walk(dep);
    }
  };
  walk(id);
  return [...seen].sort();
}

/* ------------------------------------------------------------- evaluation */

/**
 * Build the nested scope mathjs needs so that `pl.revenue` resolves.
 * Dotted ids become nested objects: { pl: { revenue: 123 } }.
 */
function buildScope(values: Map<string, number>): Record<string, unknown> {
  const scope: Record<string, unknown> = {};
  for (const [key, value] of values) {
    const parts = key.split(".");
    if (parts.length === 1) {
      scope[key] = value;
      continue;
    }
    let cursor = scope;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const part = parts[i] as string;
      if (typeof cursor[part] !== "object" || cursor[part] === null) {
        cursor[part] = {};
      }
      cursor = cursor[part] as Record<string, unknown>;
    }
    cursor[parts[parts.length - 1] as string] = value;
  }
  return scope;
}

export interface EvaluationResult {
  metrics: Map<string, MetricResult>;
  /** Account ids that at least one active formula needs. The checklist, derived. */
  requiredAccounts: string[];
  /** Required accounts with no fact and no override, for this scope. */
  missingAccounts: string[];
}

export function evaluateFormulas(
  formulas: FormulaSpec[],
  scope: EvaluationScope,
): EvaluationResult {
  const active = formulas.filter((f) => f.active !== false);
  const { order, deps } = buildDependencyGraph(active);
  const byId = new Map(active.map((f) => [f.id, f]));
  const formulaIds = new Set(byId.keys());

  const values = new Map<string, number>();
  for (const [accountId, resolved] of scope.accounts) {
    values.set(accountId, resolved.value);
  }

  const metrics = new Map<string, MetricResult>();

  for (const id of order) {
    const formula = byId.get(id);
    if (!formula) continue;

    const direct = deps.get(id) ?? [];
    const transitive = transitiveDependencies(id, deps);

    // A metric override short-circuits computation but still reports its dependencies,
    // so the checklist and the audit trail stay honest.
    const metricOverride = scope.metricOverrides?.get(id);
    if (metricOverride) {
      values.set(id, metricOverride.value);
      metrics.set(id, {
        id,
        label: formula.label,
        status: "ok",
        value: metricOverride.value,
        source: "override",
        missing: [],
        dependsOn: transitive,
      });
      continue;
    }

    const missing = direct.filter((dep) => {
      if (formulaIds.has(dep)) {
        const upstream = metrics.get(dep);
        return !upstream || upstream.status !== "ok";
      }
      return !values.has(dep);
    });

    if (missing.length > 0) {
      // Report the missing *leaves*, not the intermediate metric, so the UI can point at
      // the field the user actually has to supply.
      const leaves = new Set<string>();
      for (const dep of missing) {
        if (formulaIds.has(dep)) {
          for (const leaf of metrics.get(dep)?.missing ?? [dep]) leaves.add(leaf);
        } else {
          leaves.add(dep);
        }
      }
      metrics.set(id, {
        id,
        label: formula.label,
        status: "missing_inputs",
        value: null,
        source: null,
        missing: [...leaves].sort(),
        dependsOn: transitive,
      });
      continue;
    }

    try {
      const result = parseChecked(formula.expression).evaluate(buildScope(values));
      const numeric = typeof result === "number" ? result : Number(result);
      if (!Number.isFinite(numeric)) {
        // Every input is a finite number by construction, so a non-finite result means
        // a zero denominator. Name the zero-valued inputs: "division by zero" alone
        // sends the advisor hunting, "revenue is 0" tells them what to fix.
        const zeroed = direct.filter((dep) => values.get(dep) === 0);
        const detail =
          zeroed.length > 0 ? ` — ${zeroed.join(", ")} is 0` : "";
        metrics.set(id, {
          id,
          label: formula.label,
          status: "error",
          value: null,
          source: null,
          missing: [],
          dependsOn: transitive,
          error: `Division by zero${detail}`,
        });
        continue;
      }
      values.set(id, numeric);
      metrics.set(id, {
        id,
        label: formula.label,
        status: "ok",
        value: numeric,
        source: "computed",
        missing: [],
        dependsOn: transitive,
      });
    } catch (cause) {
      metrics.set(id, {
        id,
        label: formula.label,
        status: "error",
        value: null,
        source: null,
        missing: [],
        dependsOn: transitive,
        error: (cause as Error).message,
      });
    }
  }

  const required = requiredAccounts(active);
  const missingAccounts = required.filter((a) => !scope.accounts.has(a));

  return { metrics, requiredAccounts: required, missingAccounts };
}

/**
 * The derived checklist: every non-formula identifier any active formula depends on,
 * directly or transitively. Never hand-maintained.
 */
export function requiredAccounts(formulas: FormulaSpec[]): string[] {
  const active = formulas.filter((f) => f.active !== false);
  const { deps } = buildDependencyGraph(active);
  const formulaIds = new Set(active.map((f) => f.id));
  const required = new Set<string>();
  for (const id of formulaIds) {
    for (const dep of transitiveDependencies(id, deps)) {
      if (!formulaIds.has(dep)) required.add(dep);
    }
  }
  return [...required].sort();
}

/**
 * Validate a candidate expression before it is saved. Used by the formula editor so a
 * bad edit is rejected at the point of editing rather than breaking every client's
 * dashboard — which is the risk created by formula edits being global.
 */
export interface ValidationResult {
  ok: boolean;
  error?: string;
  dependencies: string[];
  unknownReferences: string[];
}

export function validateExpression(
  expression: string,
  candidateId: string,
  allFormulas: FormulaSpec[],
  knownAccountIds: Iterable<string>,
): ValidationResult {
  let dependencies: string[];
  try {
    dependencies = extractDependencies(expression);
  } catch (cause) {
    return { ok: false, error: (cause as Error).message, dependencies: [], unknownReferences: [] };
  }

  const accountSet = new Set(knownAccountIds);
  const others = allFormulas.filter((f) => f.id !== candidateId);
  const formulaSet = new Set(others.map((f) => f.id));

  const unknown = dependencies.filter(
    (dep) => !accountSet.has(dep) && !formulaSet.has(dep) && dep !== candidateId,
  );

  const withCandidate: FormulaSpec[] = [
    ...others,
    { id: candidateId, label: candidateId, expression },
  ];

  try {
    buildDependencyGraph(withCandidate);
  } catch (cause) {
    return {
      ok: false,
      error: (cause as Error).message,
      dependencies,
      unknownReferences: unknown,
    };
  }

  if (unknown.length > 0) {
    return {
      ok: false,
      error: `Unknown reference${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}`,
      dependencies,
      unknownReferences: unknown,
    };
  }

  return { ok: true, dependencies, unknownReferences: [] };
}
