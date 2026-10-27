import { DEFAULT_RUBRIC, rubricProblems, type RubricCriterion } from "./rubric.js";
import type { ParamDef, ParamValues, RunsSpec, TestDefinition } from "./api.js";

// Which tests run, in which order, and how many attempts each gets. Same rules as the bench
// robot's pickTests, from declarations instead of hand-kept tables (docs/plan.md, section 6).

/** Problems with a pack's test graph: unknown ids in `needs`/`inside`, cycles. Empty when fine. */
export function checkTests(tests: readonly TestDefinition[], rubric?: readonly RubricCriterion[]): string[] {
  const byId = new Map(tests.map((t) => [t.id, t]));
  const problems: string[] = [];
  const criteria = new Set((rubric && rubric.length > 0 ? rubric : DEFAULT_RUBRIC).map((c) => c.id));
  for (const t of tests) {
    problems.push(...rubricProblems(t.meta.review?.add, `test ${t.id} review.add`));
    for (const d of t.meta.review?.drop ?? []) if (!criteria.has(d)) problems.push(`Test ${t.id} drops the criterion "${d}", which the pack's rubric doesn't have.`);
    for (const n of t.meta.needs ?? []) if (!byId.has(n)) problems.push(`Test ${t.id} needs "${n}", which doesn't exist.`);
    if (t.meta.inside !== undefined) {
      const parent = byId.get(t.meta.inside);
      if (!parent) problems.push(`Test ${t.id} is inside "${t.meta.inside}", which doesn't exist.`);
      else if (parent.meta.inside !== undefined) problems.push(`Test ${t.id} is inside ${parent.id}, which is itself inside another test. Only one level is allowed.`);
    }
  }
  // Cycles over needs (a child's needs count as its parent's).
  const state = new Map<string, "visiting" | "done">();
  const visit = (id: string, trail: string[]): void => {
    if (state.get(id) === "done") return;
    if (state.get(id) === "visiting") {
      problems.push(`Tests need each other in a circle: ${[...trail.slice(trail.indexOf(id)), id].join(" → ")}.`);
      return;
    }
    state.set(id, "visiting");
    for (const n of byId.get(id)?.meta.needs ?? []) if (byId.has(n)) visit(n, [...trail, id]);
    state.set(id, "done");
  };
  for (const t of tests) visit(t.id, []);
  return problems;
}

/**
 * The tests to run for a choice, in run order: every chosen test, what they need (transitively),
 * a chosen child's parent, and a chosen parent's children. Order is the pack's declaration order,
 * moved only as far as needed so a test runs after what it needs. Children are not in the list:
 * their parent's body runs them. Returns `{ order, children }`.
 */
export function planTests(tests: readonly TestDefinition[], chosen: readonly string[] | undefined): { order: string[]; children: Map<string, string[]> } {
  const byId = new Map(tests.map((t) => [t.id, t]));
  const children = new Map<string, string[]>();
  for (const t of tests) if (t.meta.inside !== undefined) children.set(t.meta.inside, [...(children.get(t.meta.inside) ?? []), t.id]);

  const picked = new Set<string>();
  const add = (id: string) => {
    const t = byId.get(id);
    if (!t || picked.has(id)) return;
    picked.add(id);
    for (const n of t.meta.needs ?? []) add(n);
    if (t.meta.inside !== undefined) add(t.meta.inside);
    for (const c of children.get(id) ?? []) add(c);
  };
  for (const id of chosen && chosen.length > 0 ? chosen : tests.map((t) => t.id)) {
    if (!byId.has(id)) throw new Error(`The pack has no test "${id}".`);
    add(id);
  }

  // A top-level test waits for its needs and for its children's needs.
  const top = tests.filter((t) => picked.has(t.id) && t.meta.inside === undefined);
  const needsOf = (t: TestDefinition): string[] => {
    const own = [...(t.meta.needs ?? [])];
    for (const c of children.get(t.id) ?? []) own.push(...(byId.get(c)?.meta.needs ?? []));
    return own.map((n) => byId.get(n)?.meta.inside ?? n).filter((n) => n !== t.id);
  };
  const order: string[] = [];
  const placed = new Set<string>();
  const place = (t: TestDefinition) => {
    if (placed.has(t.id)) return;
    placed.add(t.id);
    for (const n of needsOf(t)) {
      const dep = byId.get(n);
      if (dep && picked.has(dep.id)) place(dep);
    }
    order.push(t.id);
  };
  for (const t of top) place(t);
  const kids = new Map<string, string[]>();
  for (const [parent, list] of children) if (picked.has(parent)) kids.set(parent, list.filter((c) => picked.has(c)));
  return { order, children: kids };
}

/** How many attempts a test gets for these params. */
export function attemptsFor(runs: RunsSpec | undefined, params: ParamValues): number {
  let n: unknown = 1;
  if (typeof runs === "number") n = runs;
  else if (typeof runs === "function") n = runs(params);
  else if (runs && typeof runs === "object") {
    const value = params[runs.by];
    const hit = value === undefined ? undefined : runs[String(value)];
    n = typeof hit === "number" ? hit : (runs.default ?? 1);
  }
  if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > 1000) throw new Error(`"runs" must give a whole number from 0 to 1000, got ${String(n)}.`);
  return n;
}

export function paramType(def: ParamDef): "string" | "number" | "boolean" {
  if (def.type) return def.type;
  const sample = def.default ?? def.choices?.[0];
  return typeof sample === "number" ? "number" : typeof sample === "boolean" ? "boolean" : "string";
}

/** Fills defaults and checks given values against the pack's params. Throws a readable error. */
export function resolveParams(defs: Record<string, ParamDef>, given: Record<string, unknown> = {}): ParamValues {
  const out: ParamValues = {};
  for (const key of Object.keys(given)) if (!(key in defs)) throw new Error(`The pack has no parameter "${key}".`);
  for (const [key, def] of Object.entries(defs)) {
    const type = paramType(def);
    let v = given[key] ?? def.default;
    if (v === undefined) throw new Error(`Parameter "${key}" needs a value.`);
    if (type === "number" && typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) v = Number(v);
    if (type === "boolean" && (v === "true" || v === "false")) v = v === "true";
    if (typeof v !== type) throw new Error(`Parameter "${key}" must be a ${type}.`);
    if (def.choices && !def.choices.includes(v as string | number)) throw new Error(`Parameter "${key}" must be one of: ${def.choices.join(", ")}.`);
    out[key] = v as string | number | boolean;
  }
  return out;
}
