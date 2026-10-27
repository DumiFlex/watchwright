import { isMap, isScalar, isSeq, LineCounter, parseDocument, type Document, type Node, type Pair } from "yaml";
import { closest, hasVariable, type Prop, type Shape } from "./shape.js";
import { STEP_BY_NAME, TEST_META, type Step, type StepArgs } from "./steps.js";
import { TARGET_MAP } from "./targets.js";

// Reads YAML test files (and `pack.yaml`, through checkValue) into plain values, checking them
// against their shapes. Every problem carries its line and column, so the loader, the editor and
// agents can point at it.

export interface Problem {
  line: number;
  col: number;
  message: string;
}

export interface YamlTest {
  id: string;
  /** Test metadata, as in code (`title`, `section`, `runs`, …). */
  meta: Record<string, unknown>;
  steps: Step[];
  line: number;
  col: number;
}

export interface Parsed<T> {
  value: T;
  problems: Problem[];
}

class Checker {
  readonly problems: Problem[] = [];
  constructor(readonly lc: LineCounter) {}

  at(node: Node | Pair | null | undefined): { line: number; col: number } {
    const n = node && "range" in node ? node : node && "key" in node ? (node.key as Node | null) : null;
    const offset = n?.range?.[0] ?? 0;
    const p = this.lc.linePos(offset);
    return { line: p.line, col: p.col };
  }

  problem(node: Node | Pair | null | undefined, message: string): void {
    this.problems.push({ ...this.at(node), message });
  }

  /** Checks a node against a shape and returns its plain value (best effort when it doesn't fit). */
  value(node: Node | null, shape: Shape, where: string): unknown {
    if (node === null || (isScalar(node) && node.value === null)) {
      this.problem(node, `${where} needs a value.`);
      return undefined;
    }
    switch (shape.t) {
      case "any":
        return node.toJSON();
      case "string": {
        if (!isScalar(node) || typeof node.value === "object") return this.wrong(node, where, "text");
        const v = String(node.value);
        if (shape.enum && !hasVariable(v) && !shape.enum.includes(v)) {
          const near = closest(v, shape.enum);
          this.problem(node, `${where} is one of ${shape.enum.join(", ")}${near ? `. Did you mean "${near}"?` : "."}`);
        }
        if (shape.pattern && !new RegExp(shape.pattern).test(v)) this.problem(node, `${where} "${v}" isn't valid here.`);
        return v;
      }
      case "number":
      case "integer": {
        if (!isScalar(node)) return this.wrong(node, where, "a number");
        const v = node.value;
        if (typeof v === "string" && hasVariable(v)) return v;
        if (typeof v !== "number" || !Number.isFinite(v) || (shape.t === "integer" && !Number.isInteger(v))) return this.wrong(node, where, shape.t === "integer" ? "a whole number" : "a number");
        if (shape.min !== undefined && v < shape.min) this.problem(node, `${where} must be at least ${shape.min}.`);
        if (shape.max !== undefined && v > shape.max) this.problem(node, `${where} must be at most ${shape.max}.`);
        return v;
      }
      case "boolean": {
        if (!isScalar(node)) return this.wrong(node, where, "true or false");
        const v = node.value;
        if (typeof v === "string" && hasVariable(v)) return v;
        if (typeof v !== "boolean") return this.wrong(node, where, "true or false");
        return v;
      }
      case "scalar": {
        if (!isScalar(node) || typeof node.value === "object") return this.wrong(node, where, "text, a number or true/false");
        return node.value;
      }
      case "match": {
        if (isScalar(node) && typeof node.value !== "object") return String(node.value);
        if (isMap(node)) {
          const v = this.value(node, { t: "object", props: { regex: { t: "string", required: true }, flags: { t: "string", pattern: "^[dgimsuy]*$" } } }, where) as { regex?: string };
          if (typeof v.regex === "string") {
            try {
              new RegExp(v.regex);
            } catch (err) {
              this.problem(node, `${where}: the regex doesn't parse (${(err as Error).message}).`);
            }
          }
          return v;
        }
        return this.wrong(node, where, "text or { regex }");
      }
      case "target":
        if (isScalar(node) && typeof node.value === "string") return node.value;
        if (isMap(node)) return this.value(node, TARGET_MAP, where);
        return this.wrong(node, where, "a selector or a map such as { role: button, name: Save }");
      case "steps":
        if (!isSeq(node)) return this.wrong(node, where, "a list of steps");
        {
          const list = this.steps(node.items as (Node | null)[]);
          // A comment above the first item belongs to the list in YAML's model; give it to the step.
          const first = list[0];
          const c = node.commentBefore?.trim();
          if (first && c && !first.comment && first.line === this.at(node.items[0] as Node).line) first.comment = c;
          return list;
        }
      case "array": {
        if (!isSeq(node)) return this.wrong(node, where, "a list");
        if (shape.min !== undefined && node.items.length < shape.min) this.problem(node, `${where} needs at least ${shape.min}.`);
        return (node.items as (Node | null)[]).map((n, i) => this.value(n, shape.items, `${where}[${i}]`));
      }
      case "union": {
        const kind = isMap(node) ? "map" : isSeq(node) ? "list" : "scalar";
        const fits = shape.of.find((s) => fitsKind(s, kind));
        if (!fits) return this.wrong(node, where, describeUnion(shape.of));
        return this.value(node, fits, where);
      }
      case "object": {
        if (!isMap(node)) return this.wrong(node, where, "a map of keys");
        const out: Record<string, unknown> = {};
        for (const pair of node.items) {
          const key = isScalar(pair.key) ? String(pair.key.value) : null;
          if (key === null) {
            this.problem(pair, `${where} has a key that isn't text.`);
            continue;
          }
          const prop = shape.props[key];
          const sub = prop ?? shape.extra;
          if (!sub) {
            const near = closest(key, Object.keys(shape.props));
            this.problem(pair, `${where} has no "${key}"${near ? `. Did you mean "${near}"?` : `. It takes ${Object.keys(shape.props).join(", ")}.`}`);
            continue;
          }
          if (key in out) this.problem(pair, `${where} has "${key}" twice.`);
          out[key] = this.value(pair.value as Node | null, sub, `${where}.${key}`);
        }
        for (const [k, p] of Object.entries(shape.props)) if (p.required && !(k in out)) this.problem(node, `${where} needs "${k}".`);
        if (shape.check) {
          const msg = shape.check(out);
          if (msg) this.problem(node, `${where}: ${msg}`);
        }
        return out;
      }
    }
  }

  wrong(node: Node, where: string, wanted: string): undefined {
    this.problem(node, `${where} should be ${wanted}.`);
    return undefined;
  }

  steps(items: readonly (Node | null)[]): Step[] {
    const out: Step[] = [];
    for (const item of items) {
      const step = this.step(item);
      if (step) out.push(step);
    }
    return out;
  }

  step(node: Node | null): Step | null {
    const { line, col } = this.at(node);
    if (isScalar(node) && typeof node.value === "string") {
      const def = STEP_BY_NAME.get(node.value);
      if (!def) {
        this.unknownStep(node, node.value);
        return null;
      }
      if (!def.bare) {
        this.problem(node, `${def.name} needs ${def.short ? `a value: "- ${def.name}: …"` : "its fields"}.`);
        return null;
      }
      return withComment({ name: def.name, args: {}, line, col }, node);
    }
    if (!isMap(node)) {
      this.problem(node, "A step is a name with its value, such as `- click: { role: button, name: Save }`.");
      return null;
    }
    // The step's name is the one key that is a step; other keys at the same level are its fields
    // ("flat" form: `- click: "#save"` with `timeout: 500` under it). No field shares a step's name.
    const names = node.items.filter((p) => isScalar(p.key) && STEP_BY_NAME.has(String(p.key.value)));
    if (names.length === 0) {
      const first = node.items[0];
      const key = first && isScalar(first.key) ? String(first.key.value) : "";
      this.unknownStep(first ?? node, key);
      return null;
    }
    if (names.length > 1) {
      this.problem(names[1], `One step per list item: put "${String((names[1]!.key as { value: unknown }).value)}" in its own "- " item.`);
      return null;
    }
    const pair = names[0]!;
    const def = STEP_BY_NAME.get(String((pair.key as { value: unknown }).value))!;
    const where = def.name;
    const before = this.problems.length;
    const args: StepArgs = {};
    const v = pair.value as Node | null;
    const fieldShape = (k: string): Prop | undefined => def.fields[k];
    const setField = (k: string, n: Node | null, at: Node | Pair) => {
      const f = fieldShape(k);
      if (!f) {
        const near = closest(k, Object.keys(def.fields));
        this.problem(at, `${def.name} has no "${k}"${near ? `. Did you mean "${near}"?` : Object.keys(def.fields).length ? `. It takes ${Object.keys(def.fields).join(", ")}.` : "."}`);
        return;
      }
      if (k in args) this.problem(at, `${def.name} has "${k}" twice.`);
      args[k] = this.value(n, f, `${where}.${k}`);
    };
    if (v === null || (isScalar(v) && v.value === null)) {
      if (!def.bare && node.items.length === 1) this.problem(pair, `${def.name} needs ${def.short ? "a value" : "its fields"}.`);
    } else if (isMap(v) && !(def.short && (fieldShape(def.short)!.t === "target" || fieldShape(def.short)!.t === "match") && !looksLikeFields(v, def.fields))) {
      for (const p of v.items) setField(isScalar(p.key) ? String(p.key.value) : "?", p.value as Node | null, p);
    } else if (def.short) {
      setField(def.short, v, pair);
    } else {
      this.problem(v, `${def.name} takes its fields as a map: ${Object.keys(def.fields).join(", ")}.`);
    }
    for (const p of node.items) if (p !== pair) setField(isScalar(p.key) ? String(p.key.value) : "?", p.value as Node | null, p);
    for (const [k, f] of Object.entries(def.fields)) if (f.required && !(k in args)) this.problem(node, `${def.name} needs "${k}".`);
    if (def.check && this.problems.length === before) {
      const msg = def.check(args);
      if (msg) this.problem(node, msg);
    }
    return withComment({ name: def.name, args, line, col }, node);
  }

  unknownStep(node: Node | Pair, name: string): void {
    const near = closest(name, STEP_BY_NAME.keys());
    this.problem(node, `"${name}" isn't a step.${near ? ` Did you mean "${near}"?` : ""}`);
  }
}

function withComment(step: Step, node: Node): Step {
  const c = node.commentBefore?.trim();
  if (c) step.comment = c;
  return step;
}

/** A map value under a step whose short field is a target: `- click: { role: button }` is the target itself, `- click: { target: …, timeout: 1 }` is the fields. */
function looksLikeFields(map: Node, fields: Record<string, Prop>): boolean {
  if (!isMap(map)) return false;
  return map.items.some((p) => isScalar(p.key) && String(p.key.value) in fields);
}

function fitsKind(s: Shape, kind: "map" | "list" | "scalar"): boolean {
  switch (s.t) {
    case "object":
      return kind === "map";
    case "array":
    case "steps":
      return kind === "list";
    case "target":
    case "match":
      return kind !== "list";
    case "any":
      return true;
    case "union":
      return s.of.some((x) => fitsKind(x, kind));
    default:
      return kind === "scalar";
  }
}

function describeUnion(of: readonly Shape[]): string {
  return of.map((s) => (s.t === "array" ? "a list" : s.t === "object" ? "a map" : s.t === "integer" ? "a whole number" : s.t === "string" ? "text" : s.t)).join(" or ");
}

/** Parses YAML text into a document with positions. */
export function parseText(text: string): { doc: Document; lc: LineCounter; problems: Problem[] } {
  const lc = new LineCounter();
  const doc = parseDocument(text, { lineCounter: lc, prettyErrors: false, uniqueKeys: false });
  const problems: Problem[] = [...doc.errors, ...doc.warnings].map((e) => {
    const p = lc.linePos(e.pos[0]);
    return { line: p.line, col: p.col, message: e.message.split("\n")[0]! };
  });
  return { doc, lc, problems };
}

/** Checks a whole YAML document against a shape (pack.yaml uses this). */
export function checkDocument<T>(text: string, shape: Shape, where: string): Parsed<T | undefined> {
  const { doc, lc, problems } = parseText(text);
  if (problems.length > 0) return { value: undefined, problems };
  const c = new Checker(lc);
  const value = c.value(doc.contents as Node | null, shape, where) as T;
  return { value, problems: c.problems };
}

const FILE_DEFAULTS = ["section", "tags"];

/** Reads a YAML test file: one test (with `steps`), or several under `tests:`. */
export function parseTestFile(text: string): Parsed<YamlTest[]> {
  const { doc, lc, problems } = parseText(text);
  if (problems.length > 0) return { value: [], problems };
  const c = new Checker(lc);
  const root = doc.contents as Node | null;
  const tests: YamlTest[] = [];
  if (!isMap(root)) {
    c.problem(root, "A test file is a map: `id`, `title`, `steps`, … (or `tests:` with a list of them).");
    return { value: [], problems: c.problems };
  }
  const testsPair = root.items.find((p) => isScalar(p.key) && p.key.value === "tests");
  if (testsPair) {
    const defaults: Record<string, Node | null> = {};
    for (const p of root.items) {
      if (p === testsPair) continue;
      const k = isScalar(p.key) ? String(p.key.value) : "?";
      if (FILE_DEFAULTS.includes(k)) defaults[k] = p.value as Node | null;
      else c.problem(p, `With "tests:", the file's other keys can only be ${FILE_DEFAULTS.join(" and ")} (shared by its tests). Put "${k}" in a test.`);
    }
    const list = testsPair.value as Node | null;
    if (!isSeq(list)) c.problem(testsPair, "tests should be a list of tests.");
    else for (const item of list.items as (Node | null)[]) readTest(c, item, defaults, tests);
  } else readTest(c, root, {}, tests);
  const seen = new Set<string>();
  for (const t of tests) {
    if (seen.has(t.id)) c.problems.push({ line: t.line, col: t.col, message: `Two tests have the id "${t.id}".` });
    seen.add(t.id);
  }
  return { value: tests, problems: c.problems };
}

const TEST_SHAPE: Shape = { t: "object", props: { ...TEST_META, steps: { t: "steps", required: true, doc: "What the test does, step by step." } } };

function readTest(c: Checker, node: Node | null, defaults: Record<string, Node | null>, out: YamlTest[]): void {
  if (!isMap(node)) {
    c.problem(node, "A test is a map: `id`, `title`, `steps`, ….");
    return;
  }
  const before = c.problems.length;
  const value = c.value(node, TEST_SHAPE, "test") as Record<string, unknown>;
  for (const [k, n] of Object.entries(defaults)) if (value[k] === undefined) value[k] = c.value(n, TEST_META[k]!, k);
  if (typeof value.id !== "string") return;
  const { id, steps, ...meta } = value;
  const { line, col } = c.at(node);
  if (c.problems.length === before || Array.isArray(steps)) out.push({ id, meta, steps: (steps as Step[] | undefined) ?? [], line, col });
}

/** Formats problems the way the loader reports them: `tests/a.yaml:6:5 "fil" isn't a step.` */
export function formatProblems(file: string, problems: readonly Problem[]): string[] {
  return problems.map((p) => `${file}:${p.line}:${p.col} ${p.message}`);
}
