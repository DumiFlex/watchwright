// The Steps view's model of a YAML test file: the steps as a tree (with where each sits in the
// file), and edits that change only the step they touch. Edits go through `yaml`'s document
// model, so the comments, quoting and layout the person wrote elsewhere stay as they were.
import { isMap, isScalar, isSeq, LineCounter, parseDocument, YAMLMap, YAMLSeq, type Document, type Node, type Pair, type Scalar } from "yaml";
import { diffLines } from "./diff";
import { STEP_BY_NAME, summarize, type StepArgs, type StepDef } from "./yamlsteps";

export type NodePath = (string | number)[];

export interface StepList {
  /** Where the list is: `["steps"]`, `["tests", 1, "steps"]`, `[…, 3, "if", "then"]`. */
  path: NodePath;
  /** The field of the parent step that holds it (`steps`, `then`, `else`), or null at the top. */
  field: string | null;
  steps: StepNode[];
}

export interface StepNode {
  path: NodePath;
  /** The step's name, or the item's first key when it isn't a step. */
  name: string;
  known: boolean;
  args: StepArgs;
  summary: string;
  /** Lines (from 1) the item spans in the file. */
  line: number;
  endLine: number;
  comment: string | null;
  /** Lists of steps inside this one (`if` has then and else). */
  lists: StepList[];
}

export interface TestNode {
  /** Path of the test's map: `[]` for a one-test file, `["tests", i]` otherwise. */
  path: NodePath;
  id: string;
  title: string | null;
  line: number;
  steps: StepList;
}

type Form = { kind: "bare" } | { kind: "short"; pair: Pair } | { kind: "fields"; pair: Pair; map: YAMLMap } | { kind: "empty"; pair: Pair };

const keyOf = (p: Pair): string => (isScalar(p.key) ? String((p.key as Scalar).value) : "");

/** The pair that names the step in an item map (the one key that is a step). */
function namePair(item: YAMLMap): Pair | null {
  return (item.items.find((p) => STEP_BY_NAME.has(keyOf(p))) as Pair | undefined) ?? null;
}

/** How a step item is written, as parse.ts reads it. */
function formOf(item: Node, def: StepDef): Form {
  if (!isMap(item)) return { kind: "bare" };
  const pair = namePair(item)!;
  const v = pair.value as Node | null;
  if (v === null || (isScalar(v) && v.value === null)) return { kind: "empty", pair };
  const shortShape = def.short ? def.fields[def.short] : undefined;
  const targetLike = shortShape && (shortShape.t === "target" || shortShape.t === "match");
  if (isMap(v) && !(targetLike && !v.items.some((p) => keyOf(p as Pair) in def.fields))) return { kind: "fields", pair, map: v };
  return { kind: "short", pair };
}

function argsOf(item: Node, def: StepDef): StepArgs {
  const form = formOf(item, def);
  const args: StepArgs = {};
  if (form.kind === "fields") Object.assign(args, form.map.toJSON());
  else if (form.kind === "short" && def.short) args[def.short] = (form.pair.value as Node).toJSON();
  if (isMap(item)) for (const p of item.items as Pair[]) if (p !== (form as { pair?: Pair }).pair && keyOf(p) !== def.name) args[keyOf(p)] = (p.value as Node | null)?.toJSON() ?? null;
  return args;
}

interface Ctx {
  lc: LineCounter;
}

function lineOf(ctx: Ctx, offset: number): number {
  return ctx.lc.linePos(offset).line;
}

function readList(ctx: Ctx, seq: YAMLSeq, path: NodePath, field: string | null): StepList {
  const steps: StepNode[] = [];
  (seq.items as (Node | null)[]).forEach((item, i) => {
    if (!item) return;
    const p = [...path, i];
    const range = item.range ?? [0, 0, 0];
    const name = isScalar(item) ? String(item.value) : isMap(item) ? (namePair(item) ? keyOf(namePair(item)!) : keyOf(item.items[0] as Pair)) : "?";
    const def = STEP_BY_NAME.get(name);
    const args = def ? argsOf(item, def) : {};
    const lists: StepList[] = [];
    if (def && isMap(item)) {
      const form = formOf(item, def);
      for (const [k, f] of Object.entries(def.fields)) {
        if (f.t !== "steps") continue;
        const inFields = form.kind === "fields" ? form.map.get(k, true) : undefined;
        const flat = item.get(k, true);
        const node = (inFields ?? flat) as Node | undefined;
        const base = inFields || (form.kind === "fields" && !flat) ? [...p, name, k] : [...p, k];
        if (isSeq(node)) lists.push(readList(ctx, node, base, k));
        else lists.push({ path: base, field: k, steps: [] });
      }
    }
    const comment = (i === 0 ? (item.commentBefore ?? seq.commentBefore) : item.commentBefore)?.trim() ?? null;
    steps.push({
      path: p,
      name,
      known: !!def,
      args,
      summary: def ? safeSummary(name, args) : name,
      line: lineOf(ctx, range[0]),
      endLine: lineOf(ctx, Math.max(range[0], (range[1] ?? range[0]) - 1)),
      comment: comment || null,
      lists,
    });
  });
  return { path, field, steps };
}

function safeSummary(name: string, args: StepArgs): string {
  try {
    return summarize({ name, args });
  } catch {
    return name;
  }
}

/** The tests of a YAML test file with their steps, or null when the text isn't YAML a test file can be. */
export function readTests(text: string): TestNode[] | null {
  const lc = new LineCounter();
  const doc = parseDocument(text, { lineCounter: lc, uniqueKeys: false });
  if (doc.errors.length > 0) return null;
  const root = doc.contents;
  if (!isMap(root)) return null;
  const ctx = { lc };
  const one = (map: YAMLMap, path: NodePath): TestNode => {
    const steps = map.get("steps", true);
    const id = map.get("id");
    const title = map.get("title");
    return {
      path,
      id: typeof id === "string" || typeof id === "number" ? String(id) : "",
      title: typeof title === "string" ? title : null,
      line: lineOf(ctx, map.range?.[0] ?? 0),
      steps: isSeq(steps) ? readList(ctx, steps, [...path, "steps"], null) : { path: [...path, "steps"], field: null, steps: [] },
    };
  };
  const tests = root.get("tests", true);
  if (isSeq(tests)) return (tests.items as (Node | null)[]).flatMap((t, i) => (isMap(t) ? [one(t, ["tests", i])] : []));
  return [one(root, [])];
}

/** The step (the deepest one) on a line of the file, for keeping the place when switching views. */
export function stepAtLine(tests: readonly TestNode[], line: number): StepNode | null {
  let found: StepNode | null = null;
  const walk = (list: StepList) => {
    for (const s of list.steps) {
      if (line >= s.line && line <= s.endLine) {
        found = s;
        s.lists.forEach(walk);
      }
    }
  };
  tests.forEach((t) => walk(t.steps));
  return found;
}

// ——— Edits ———

/** How the file indents, so a rewritten file keeps its own style. */
function styleOf(text: string): { indent: number; indentSeq: boolean } {
  const m = /^\S[^\n]*:\s*\n( +)\S/m.exec(text);
  const indent = m ? Math.min(8, m[1]!.length) : 2;
  const indentSeq = !/^(\S[^\n]*):\s*\n- /m.test(text);
  return { indent: Math.max(1, indent), indentSeq };
}

function open(text: string): Document {
  return parseDocument(text, { uniqueKeys: false });
}

function render(doc: Document, text: string): string {
  return doc.toString({ ...styleOf(text), lineWidth: 0, minContentWidth: 0, flowCollectionPadding: true });
}

/**
 * The edited file. `yaml` writes the whole document in its own style (one space before a
 * comment, its quoting), so only the lines the edit changed are taken from it; every other line
 * stays exactly as the person wrote it.
 */
function write(doc: Document, text: string): string {
  const after = render(doc, text);
  const before = render(open(text), text);
  const original = text.split("\n");
  if (before.split("\n").length !== original.length) return after; // the file doesn't map line for line
  const out: string[] = [];
  for (const d of diffLines(before, after)) {
    if (d.kind === "same") out.push(original[d.a! - 1]!);
    else if (d.kind === "add") out.push(d.text);
  }
  return out.join("\n");
}

/** A value as a node, with maps and lists written inline (`{ role: button, name: Save }`). */
function nodeOf(doc: Document, value: unknown): Node {
  const n = doc.createNode(value) as Node;
  const flow = (x: unknown) => {
    if (isMap(x) || isSeq(x)) {
      x.flow = !(isSeq(x) && x.items.some((i) => isMap(i) && namePair(i))); // a list of steps stays a block
      for (const i of x.items) flow(isMap(x) ? (i as Pair).value : i);
    }
  };
  flow(n);
  return n;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The shortest way to write a new step: `- reload`, `- goto: /`, or `- fill: { target: …, value: … }`. */
function newItem(doc: Document, name: string, args: StepArgs): Node {
  const def = STEP_BY_NAME.get(name);
  const keys = Object.keys(args).filter((k) => args[k] !== undefined);
  if (def?.bare && keys.length === 0) return doc.createNode(name) as Node;
  const map = new YAMLMap();
  if (def?.short && keys.length === 1 && keys[0] === def.short && !(isPlainObject(args[def.short]) && Object.keys(args[def.short] as object).some((k) => k in def.fields))) {
    map.add(doc.createPair(name, nodeOf(doc, args[def.short])));
    return map as Node;
  }
  const fields = new YAMLMap();
  fields.flow = !keys.some((k) => def?.fields[k]?.t === "steps");
  for (const k of keys) fields.add(doc.createPair(k, nodeOf(doc, args[k])));
  map.add(doc.createPair(name, fields));
  return map as Node;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Starting fields for a new step: its required fields, empty. */
export function blankArgs(name: string): StepArgs {
  const def = STEP_BY_NAME.get(name);
  const out: StepArgs = {};
  if (!def) return out;
  for (const [k, f] of Object.entries(def.fields)) {
    if (!f.required) continue;
    out[k] = f.t === "steps" ? [] : f.t === "array" ? [] : f.t === "number" || f.t === "integer" ? 0 : f.t === "boolean" ? true : "";
  }
  return out;
}

function seqAt(doc: Document, path: NodePath): YAMLSeq {
  const n = path.length === 0 ? doc.contents : doc.getIn(path, true);
  if (isSeq(n)) return n;
  // A step with no list there yet (`then` missing): make one.
  const list = new YAMLSeq();
  doc.setIn(path, list);
  return list;
}

/** Sets a step's fields to `args`, touching only the fields that changed. */
export function updateStep(text: string, path: NodePath, args: StepArgs): string {
  const doc = open(text);
  const item = doc.getIn(path, true) as Node | undefined;
  if (!item) return text;
  const name = isScalar(item) ? String(item.value) : isMap(item) && namePair(item) ? keyOf(namePair(item)!) : null;
  const def = name ? STEP_BY_NAME.get(name) : undefined;
  if (!name || !def) return text;
  const old = argsOf(item, def);
  const form = formOf(item, def);
  const keys = Object.keys(args).filter((k) => args[k] !== undefined);
  const fitsShort = def.short && keys.length === 1 && keys[0] === def.short && !(isPlainObject(args[def.short]) && Object.keys(args[def.short] as object).some((k) => k in def.fields));

  if (form.kind === "bare" || form.kind === "short" || form.kind === "empty") {
    const flat = isMap(item) ? (item.items as Pair[]).filter((p) => p !== (form as { pair?: Pair }).pair) : [];
    if (flat.length === 0 && (keys.length === 0 ? def.bare : fitsShort)) {
      const fresh = newItem(doc, name, args);
      keepComments(item, fresh);
      if (form.kind !== "bare" && isMap(fresh) && fitsShort && !isScalar(fresh)) {
        // Keep the item's own map (and so its layout): change only the value.
        const pair = (form as { pair: Pair }).pair;
        const val = args[def.short!];
        if (isScalar(pair.value) && !isPlainObject(val) && !Array.isArray(val)) (pair.value as Scalar).value = val;
        else pair.value = carry(pair.value as Node | null, nodeOf(doc, val));
        return write(doc, text);
      }
      doc.setIn(path, fresh);
      return write(doc, text);
    }
    if (form.kind !== "bare" && flat.length > 0) {
      // Flat form: `- click: x` with fields below; the short value stays on the name.
      const pair = (form as { pair: Pair }).pair;
      const shortVal = def.short ? args[def.short] : undefined;
      if (def.short && shortVal !== undefined && !same(shortVal, old[def.short])) pair.value = carry(pair.value as Node | null, nodeOf(doc, shortVal));
      for (const k of Object.keys({ ...old, ...args })) {
        if (k === def.short && pair.value !== null) continue;
        setField(doc, item as YAMLMap, k, args[k], old[k]);
      }
      return write(doc, text);
    }
    // Short or bare that now needs fields: write the step again with a field map.
    const fresh = newItem(doc, name, args);
    keepComments(item, fresh);
    doc.setIn(path, fresh);
    return write(doc, text);
  }

  // A field map, maybe with flat fields beside it: set each field where it is.
  for (const k of Object.keys({ ...old, ...args })) {
    const flatHere = (item as YAMLMap).has(k) && k !== name;
    setField(doc, flatHere ? (item as YAMLMap) : form.map, k, args[k], old[k]);
  }
  return write(doc, text);
}

function setField(doc: Document, map: YAMLMap, key: string, value: unknown, old: unknown): void {
  if (value === undefined) {
    map.delete(key);
    return;
  }
  if (same(value, old)) return;
  const cur = map.get(key, true) as Node | undefined;
  if (isScalar(cur) && !isPlainObject(value) && !Array.isArray(value)) cur.value = value;
  else if (isSeq(cur) && Array.isArray(value) && value.every((v) => typeof v === "object" && v !== null)) return; // lists of steps are edited step by step
  else map.set(key, carry(cur ?? null, nodeOf(doc, value)));
}

/** A step written again keeps the comment above it (and the one after it, when `after`). */
function keepComments(from: Node, to: Node, after = true): void {
  if (from.commentBefore) to.commentBefore = from.commentBefore;
  if (after && from.comment) to.comment = from.comment;
}

/** A new value node keeps the comment that was on the line of the one it replaces. */
function carry(old: Node | null, fresh: Node): Node {
  if (old?.comment) fresh.comment = old.comment;
  return fresh;
}

export function insertStep(text: string, listPath: NodePath, index: number, name: string, args: StepArgs = blankArgs(name)): string {
  const doc = open(text);
  const seq = seqAt(doc, listPath);
  seq.items.splice(Math.max(0, Math.min(index, seq.items.length)), 0, newItem(doc, name, args));
  return write(doc, text);
}

/** Puts a step of another kind in place of one, keeping the fields both kinds have. */
export function replaceStep(text: string, path: NodePath, name: string): string {
  const doc = open(text);
  const item = doc.getIn(path, true) as Node | undefined;
  if (!item) return text;
  const oldName = isScalar(item) ? String(item.value) : isMap(item) && namePair(item) ? keyOf(namePair(item)!) : "";
  const oldDef = STEP_BY_NAME.get(oldName);
  const def = STEP_BY_NAME.get(name);
  if (!def) return text;
  const old = oldDef ? argsOf(item, oldDef) : {};
  const args = blankArgs(name);
  for (const k of Object.keys(def.fields)) if (old[k] !== undefined) args[k] = old[k];
  const fresh = newItem(doc, name, args);
  keepComments(item, fresh, false);
  doc.setIn(path, fresh);
  return write(doc, text);
}

export function removeStep(text: string, path: NodePath): string {
  const doc = open(text);
  const seq = doc.getIn(path.slice(0, -1), true);
  const i = path[path.length - 1];
  if (!isSeq(seq) || typeof i !== "number") return text;
  seq.items.splice(i, 1);
  return write(doc, text);
}

export function duplicateStep(text: string, path: NodePath): string {
  const doc = open(text);
  const seq = doc.getIn(path.slice(0, -1), true);
  const i = path[path.length - 1];
  if (!isSeq(seq) || typeof i !== "number") return text;
  const item = seq.items[i] as Node | undefined;
  if (!item) return text;
  const copy = item.clone() as Node;
  copy.commentBefore = null;
  seq.items.splice(i + 1, 0, copy);
  return write(doc, text);
}

/** Moves a step within its list. */
export function moveStep(text: string, listPath: NodePath, from: number, to: number): string {
  if (from === to) return text;
  const doc = open(text);
  const seq = doc.getIn(listPath, true);
  if (!isSeq(seq) || from < 0 || from >= seq.items.length) return text;
  const [item] = seq.items.splice(from, 1);
  seq.items.splice(Math.max(0, Math.min(to, seq.items.length)), 0, item);
  return write(doc, text);
}
