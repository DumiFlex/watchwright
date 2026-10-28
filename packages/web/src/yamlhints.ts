// Hints for YAML test files in the code editor, worked out from the text around the cursor:
// which steps, fields, target keys or values fit there, and the docs of the step under the
// mouse. No editor types here, so it is tested on its own.
import { BASE_KINDS, STEP_BY_NAME, STEPS, TARGET_MAP, TEST_META, type Prop, type Shape, type StepDef } from "./yamlsteps";

export interface Hint {
  label: string;
  /** What goes in: `click: ` for a step that takes a value. */
  apply: string;
  detail?: string;
  info?: string;
  type: "step" | "field" | "value";
}

export interface HintList {
  from: number;
  options: Hint[];
  validFor: RegExp;
}

const ROLES = ["button", "link", "textbox", "checkbox", "radio", "combobox", "listbox", "option", "heading", "dialog", "alertdialog", "menu", "menuitem", "tab", "tabpanel", "list", "listitem", "row", "cell", "img", "navigation", "main", "banner", "searchbox", "switch", "slider", "spinbutton", "progressbar", "alert", "status", "table", "grid", "region", "form", "article", "tooltip"];
const TARGET_PROPS = (TARGET_MAP as Extract<Shape, { t: "object" }>).props;
const TEST_KEYS: Record<string, Prop> = { ...TEST_META, steps: { t: "steps", doc: "What the test does, step by step." } };
const FILE_KEYS: Record<string, Prop> = { ...TEST_KEYS, tests: { t: "array", items: { t: "any" }, doc: "Several tests in one file, sharing section and tags." } };
const STEP_LIST_KEYS = new Set(["steps", "then", "else"]);

const indentOf = (line: string) => /^ */.exec(line)![0].length;

function stepApply(d: StepDef): string {
  if (d.bare && !d.short) return d.name;
  return `${d.name}: `;
}

function stepHints(): Hint[] {
  return STEPS.map((d) => ({ label: d.name, apply: stepApply(d), detail: d.group, info: d.doc, type: "step" as const }));
}

function fieldHints(props: Record<string, Prop>, taken: Set<string> = new Set()): Hint[] {
  return Object.entries(props)
    .filter(([k]) => !taken.has(k))
    .map(([k, p]) => ({ label: k, apply: `${k}: `, detail: p.required ? "required" : kindWord(p), info: p.doc ?? "", type: "field" as const }));
}

function kindWord(s: Shape): string {
  switch (s.t) {
    case "target":
      return "element";
    case "steps":
      return "steps";
    case "boolean":
      return "true / false";
    case "integer":
    case "number":
      return "number";
    case "array":
      return "list";
    case "string":
      return s.enum ? s.enum.join(" | ") : "text";
    default:
      return "";
  }
}

function valueHints(s: Shape | undefined, key: string): Hint[] {
  if (!s) return [];
  if (key === "role") return ROLES.map((r) => ({ label: r, apply: r, type: "value" as const }));
  if (s.t === "string" && s.enum) return s.enum.map((e) => ({ label: e, apply: e, type: "value" as const }));
  if (s.t === "boolean") return ["true", "false"].map((e) => ({ label: e, apply: e, type: "value" as const }));
  if (s.t === "union") return s.of.flatMap((x) => valueHints(x, key));
  return [];
}

interface Owner {
  /** The key whose value holds the cursor's map (`target`, `if`), or the step of a list item. */
  key: string | null;
  /** The step this map belongs to, when the map is a step's fields or the step item itself. */
  step: StepDef | null;
  /** The owner is a list item of `tests:` (a test map). */
  test: boolean;
  /** The map sits at the top of the file. */
  top: boolean;
}

/** What a block-map line at `indent` belongs to, looking up from `row`. */
function ownerOf(lines: string[], row: number, indent: number): Owner {
  for (let i = row - 1; i >= 0; i--) {
    const line = lines[i]!;
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const ind = indentOf(line);
    const dash = /^(\s*)-\s+([\w.-]+)\s*:/.exec(line);
    const bareDash = /^(\s*)-\s+([\w.-]+)\s*$/.exec(line);
    // `- click: x` with this key under it at the item's indent: a flat field of that step.
    if (dash && dash[1]!.length + 2 === indent) {
      const step = STEP_BY_NAME.get(dash[2]!) ?? null;
      if (step) return { key: step.name, step, test: false, top: false };
      return { key: null, step: null, test: listKeyAbove(lines, i, dash[1]!.length) === "tests", top: false };
    }
    if (bareDash && bareDash[1]!.length + 2 === indent) return { key: bareDash[2]!, step: STEP_BY_NAME.get(bareDash[2]!) ?? null, test: false, top: false };
    if (ind < indent) {
      const key = /^\s*(?:-\s+)?([\w.-]+)\s*:\s*(#.*)?$/.exec(line)?.[1] ?? null;
      return { key, step: key ? (STEP_BY_NAME.get(key) ?? null) : null, test: false, top: false };
    }
  }
  return { key: null, step: null, test: false, top: indent === 0 };
}

/** The key that holds the list an item at `indent` is in (`steps`, `tests`, `then`). */
function listKeyAbove(lines: string[], row: number, indent: number): string | null {
  for (let i = row - 1; i >= 0; i--) {
    const line = lines[i]!;
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const ind = indentOf(line);
    if (ind < indent || (ind === indent && !line.trimStart().startsWith("-"))) return /^\s*(?:-\s+)?([\w.-]+)\s*:/.exec(line)?.[1] ?? null;
  }
  return null;
}

/** The fields a map under `owner` takes. */
function propsFor(owner: Owner): Record<string, Prop> | null {
  if (owner.top) return FILE_KEYS;
  if (owner.test) return TEST_KEYS;
  if (owner.step) return owner.step.fields;
  if (owner.key && isTargetKey(owner.key)) return TARGET_PROPS;
  return null;
}

const TARGET_KEYS = new Set(["target", "done", "has", "hasNot", "within", "frame", "until"]);
const isTargetKey = (k: string) => TARGET_KEYS.has(k);

/** The step and key a flow map (`{ … }`) on this line belongs to. */
function flowOwner(lineBefore: string): { step: StepDef | null; key: string | null } | null {
  let depth = 0;
  for (let i = lineBefore.length - 1; i >= 0; i--) {
    const c = lineBefore[i];
    if (c === "}") depth++;
    else if (c === "{") {
      if (depth > 0) {
        depth--;
        continue;
      }
      const head = lineBefore.slice(0, i);
      const m = /([\w.-]+)\s*:\s*$/.exec(head);
      if (!m) return null;
      const key = m[1]!;
      const step = STEP_BY_NAME.get(key) ?? null;
      // A nested map's owner is the key before it; the step is the line's first key.
      const lineStep = /^\s*-\s+([\w.-]+)\s*:/.exec(head)?.[1];
      return { step: step ?? (lineStep ? (STEP_BY_NAME.get(lineStep) ?? null) : null), key: step ? null : key };
    }
  }
  return null;
}

/** Completions at `pos` in a YAML test file, or null when there's nothing to offer. */
export function yamlCompletions(text: string, pos: number, explicit = false): HintList | null {
  const lineStart = text.lastIndexOf("\n", pos - 1) + 1;
  const before = text.slice(lineStart, pos);
  const lines = text.slice(0, lineStart).split("\n");
  lines.pop();
  const row = lines.length;
  const word = /[\w.-]*$/.exec(before)![0];
  const from = pos - word.length;
  const valid = /^[\w.-]*$/;
  if (/#/.test(before.replace(/"[^"]*"|'[^']*'/g, ""))) return null; // in a comment

  // In a flow map: `- fill: { tar|` or `target: { ro|` (keys), `{ role: bu|` (values).
  const flow = flowOwner(before);
  if (flow) {
    const tail = before.slice(before.lastIndexOf("{") + 1);
    const valueOf = /([\w.-]+)\s*:\s*[\w.-]*$/.exec(tail.split(",").pop() ?? "");
    if (valueOf) {
      const key = valueOf[1]!;
      const shape = flow.key && isTargetKey(flow.key) ? TARGET_PROPS[key] : (flow.step?.fields[key] ?? TARGET_PROPS[key]);
      const opts = valueHints(shape, key);
      return opts.length ? { from, options: opts, validFor: valid } : null;
    }
    if (!/(^|[{,])\s*[\w.-]*$/.test(tail)) return null;
    let props: Record<string, Prop>;
    if (flow.key) props = isTargetKey(flow.key) ? TARGET_PROPS : {};
    else if (flow.step) {
      const short = flow.step.short ? flow.step.fields[flow.step.short] : undefined;
      props = short && (short.t === "target" || short.t === "match") ? { ...flow.step.fields, ...TARGET_PROPS } : flow.step.fields;
    } else props = {};
    const taken = new Set([...tail.matchAll(/([\w.-]+)\s*:/g)].map((m) => m[1]!));
    const opts = fieldHints(props, taken);
    return opts.length ? { from, options: opts, validFor: valid } : null;
  }

  // A list item: a step (or, under `tests:`, a test's first key).
  const item = /^(\s*)-\s+([\w.-]*)$/.exec(before);
  if (item) {
    const parent = listKeyAbove(lines.concat(before), row, item[1]!.length);
    if (parent === "tests") return { from, options: fieldHints(TEST_KEYS), validFor: valid };
    if (parent && !STEP_LIST_KEYS.has(parent)) return null;
    return { from, options: stepHints(), validFor: valid };
  }

  // A value after `key: `.
  const val = /^(\s*)(?:-\s+)?([\w.-]+)\s*:\s+([\w.-]*)$/.exec(before);
  if (val) {
    const key = val[2]!;
    const isItem = /^\s*-\s/.test(before);
    const step = STEP_BY_NAME.get(key);
    if (isItem && step) {
      const short = step.short ? step.fields[step.short] : undefined;
      const opts = valueHints(short, step.short ?? "");
      return opts.length ? { from, options: opts, validFor: valid } : null;
    }
    const owner = isItem ? { key: null, step: null, test: false, top: false } : ownerOf(lines, row, val[1]!.length);
    const props = propsFor(owner);
    const opts = valueHints(props?.[key] ?? (key === "role" ? TARGET_PROPS.role : undefined), key);
    return opts.length ? { from, options: opts, validFor: valid } : null;
  }

  // A key in a block map.
  const key = /^(\s*)([\w.-]*)$/.exec(before);
  if (key && (word.length > 0 || explicit)) {
    const owner = ownerOf(lines, row, key[1]!.length);
    const props = propsFor(owner);
    if (!props) return null;
    return { from, options: fieldHints(props, takenKeys(lines, row, key[1]!.length)), validFor: valid };
  }
  return null;
}

/** Keys already set in the block map the cursor's line is in. */
function takenKeys(lines: string[], row: number, indent: number): Set<string> {
  const out = new Set<string>();
  for (let i = row - 1; i >= 0; i--) {
    const line = lines[i]!;
    if (!line.trim()) continue;
    const ind = indentOf(line);
    const m = /^\s*(-\s+)?([\w.-]+)\s*:/.exec(line);
    if (ind === indent && m && !m[1]) out.add(m[2]!);
    else if (m?.[1] && ind + 2 === indent) {
      out.add(m[2]!);
      // `- click: "#a"`: the value on the step's own line fills its short field.
      const short = STEP_BY_NAME.get(m[2]!)?.short;
      if (short && line.slice(m[0].length).replace(/#.*$/, "").trim()) out.add(short);
      break;
    } else if (ind < indent) break;
  }
  return out;
}

export interface HoverHint {
  from: number;
  to: number;
  title: string;
  doc: string;
  fields: { name: string; doc: string }[];
}

/** The docs of the step (or test key) whose name is at `pos`. */
export function yamlHover(text: string, pos: number): HoverHint | null {
  const lineStart = text.lastIndexOf("\n", pos - 1) + 1;
  const lineEnd = text.indexOf("\n", pos) === -1 ? text.length : text.indexOf("\n", pos);
  const line = text.slice(lineStart, lineEnd);
  const re = /[\w.-]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    const from = lineStart + m.index;
    const to = from + m[0].length;
    if (pos < from || pos > to) continue;
    const after = line.slice(m.index + m[0].length);
    const isKey = /^\s*:/.test(after) || /^\s*$/.test(after);
    const step = STEP_BY_NAME.get(m[0]);
    if (step && isKey) {
      return {
        from,
        to,
        title: step.name,
        doc: step.doc,
        fields: Object.entries(step.fields).map(([k, p]) => ({ name: k, doc: `${p.required ? "(required) " : ""}${p.doc ?? ""}` })),
      };
    }
    const meta = TEST_KEYS[m[0]];
    if (meta && /^\s*:/.test(after) && indentOf(line) <= 4) return { from, to, title: m[0], doc: meta.doc ?? "", fields: [] };
    if (BASE_KINDS.includes(m[0] as (typeof BASE_KINDS)[number]) && /^\s*:/.test(after)) return { from, to, title: m[0], doc: TARGET_PROPS[m[0]]?.doc ?? "", fields: [] };
  }
  return null;
}

/** Offsets of a line (from 1) and column in a text, for problems that only carry a position: the word there. */
export function rangeAt(text: string, line: number, col: number): { from: number; to: number } {
  let from = 0;
  for (let i = 1; i < line; i++) {
    const nl = text.indexOf("\n", from);
    if (nl === -1) break;
    from = nl + 1;
  }
  const end = text.indexOf("\n", from);
  const lineEnd = end === -1 ? text.length : end;
  const start = Math.min(lineEnd, from + Math.max(0, col - 1));
  const word = /^[^\s,{}[\]]+/.exec(text.slice(start, lineEnd));
  return { from: start, to: word ? start + word[0].length : lineEnd };
}
