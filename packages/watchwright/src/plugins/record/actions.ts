import type { StepArgs } from "../packs/yaml/steps.js";
import type { Target, TargetMap } from "../packs/yaml/targets.js";

// Playwright's recorder reports each action as JSON (`language: "jsonl"`): a name, a locator as a
// chain of `{ kind, body, options, next }` links, and the action's own fields. This turns one into
// a YAML step, so a recorded step and a hand-written one look the same (docs/plans/step-4.md, 4).

export interface RecorderLocator {
  kind: string;
  body: string;
  options?: { exact?: boolean; name?: string; attrs?: { name: string; value: unknown }[]; hasText?: string };
  next?: RecorderLocator;
}

export interface RecorderAction {
  name: string;
  url?: string;
  selector?: string;
  locator?: RecorderLocator;
  button?: "left" | "right" | "middle";
  clickCount?: number;
  modifiers?: number;
  position?: { x: number; y: number };
  text?: string;
  key?: string;
  options?: string[];
  files?: string[];
  signals?: { name: string }[];
}

const TEXT_KINDS: Record<string, keyof TargetMap> = { text: "text", label: "label", placeholder: "placeholder", alt: "alt", title: "title" };
const ROLE_FLAGS = new Set(["checked", "disabled", "expanded", "pressed", "selected", "level", "includeHidden"]);

/** One base link of a chain as a target map, or null for a kind this doesn't know. */
function baseOf(l: RecorderLocator): TargetMap | null {
  const exact = l.options?.exact === true ? { exact: true } : {};
  if (l.kind === "role") {
    const t: TargetMap = { role: l.body };
    if (l.options?.name !== undefined) Object.assign(t, { name: l.options.name }, exact);
    for (const a of l.options?.attrs ?? []) if (ROLE_FLAGS.has(a.name)) (t as Record<string, unknown>)[a.name] = a.value;
    return t;
  }
  if (l.kind === "test-id") return { testId: l.body };
  if (l.kind === "default" || l.kind === "css") return { css: l.body };
  const key = TEXT_KINDS[l.kind];
  return key ? ({ [key]: l.body, ...exact } as TargetMap) : null;
}

/**
 * The recorder's locator as a target: base kinds map one to one, `nth`/`first`/`last` and
 * `has-text` filter the element so far, and a base kind after it looks inside it (`within`).
 * Null when the chain has a link this doesn't know; the caller then keeps the selector string.
 */
export function targetOfLocator(loc: RecorderLocator): Target | null {
  let current: TargetMap | null = null;
  for (let l: RecorderLocator | undefined = loc; l; l = l.next) {
    if (current && l.kind === "nth") current.nth = Number(l.body);
    else if (current && l.kind === "first") current.first = true;
    else if (current && l.kind === "last") current.last = true;
    else if (current && l.kind === "has-text") current.hasText = l.body;
    else if (current && l.kind === "has-not-text") current.hasNotText = l.body;
    else {
      const base = baseOf(l);
      if (!base) return null;
      if (current) base.within = simplify(current);
      current = base;
    }
  }
  return current ? simplify(current) : null;
}

/** A plain CSS target is written as the selector string itself. */
function simplify(t: TargetMap): Target {
  const keys = Object.keys(t);
  return keys.length === 1 && t.css !== undefined ? t.css : t;
}

const MODIFIERS: [number, string][] = [
  [2, "Control"],
  [1, "Alt"],
  [8, "Shift"],
  [4, "Meta"],
];

/** A key with its held modifiers in Playwright's form: `Control+a`, `Shift+Enter`. */
export function keyWithModifiers(key: string, modifiers = 0): string {
  return [...MODIFIERS.filter(([bit]) => (modifiers & bit) !== 0).map(([, name]) => name), key].join("+");
}

export interface RecordedStep {
  name: string;
  args: StepArgs;
}

/**
 * The YAML step for a recorder action, or null for actions that aren't steps (the first page
 * opening, a new tab, an assertion the recorder makes on its own). `baseURL` makes a `goto` to the
 * pack's own site relative.
 */
export function stepOfAction(a: RecorderAction, baseURL: string | null): RecordedStep | null {
  const target = (): Target => (a.locator ? targetOfLocator(a.locator) : null) ?? a.selector ?? "body";
  switch (a.name) {
    case "navigate":
      return a.url && a.url !== "about:blank" ? { name: "goto", args: { url: relativeUrl(a.url, baseURL) } } : null;
    case "click": {
      const args: StepArgs = { target: target() };
      if (a.button && a.button !== "left") args.button = a.button;
      if (a.position) args.position = { x: Math.round(a.position.x), y: Math.round(a.position.y) };
      return { name: (a.clickCount ?? 1) >= 2 ? "dblclick" : "click", args };
    }
    case "fill":
      return { name: "fill", args: { target: target(), value: a.text ?? "" } };
    case "press":
      return { name: "press", args: { target: target(), key: keyWithModifiers(a.key ?? "", a.modifiers) } };
    case "check":
    case "uncheck":
      return { name: a.name, args: { target: target() } };
    case "select": {
      const values = a.options ?? [];
      return { name: "select", args: { target: target(), option: values.length === 1 ? values[0]! : values } };
    }
    case "setInputFiles":
      return { name: "upload", args: { target: target(), files: a.files ?? [] } };
    default:
      return null;
  }
}

/** `http://site/todo/` with base `http://site/` is `/todo/`; other sites keep the full URL. */
export function relativeUrl(url: string, baseURL: string | null): string {
  if (!baseURL) return url;
  try {
    const u = new URL(url);
    const b = new URL(baseURL);
    if (u.origin !== b.origin) return url;
    return `${u.pathname}${u.search}${u.hash}` || "/";
  } catch {
    return url;
  }
}
