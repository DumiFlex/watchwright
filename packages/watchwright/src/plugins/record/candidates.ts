import type { ElementHandle, Page } from "playwright";
import { locate } from "../packs/yaml/run.js";
import type { Target, TargetMap } from "../packs/yaml/targets.js";

// The targets that pick out the element under a point. Record offers them beside the target
// Playwright's recorder chose, so a person can pick the one that fits (a test id over a text that
// may change), and Check uses the best one. Each is checked on the page: it must match exactly
// one element, and that element must be the one under the point.

/** What the page says about the element under a point (read in the page, so plain data). */
export interface ElementInfo {
  tag: string;
  type: string | null;
  role: string | null;
  testId: string | null;
  ariaLabel: string | null;
  labels: string[];
  placeholder: string | null;
  alt: string | null;
  title: string | null;
  text: string;
  id: string | null;
  name: string | null;
  href: boolean;
  box: { x: number; y: number; width: number; height: number };
  value: string | null;
  checked: boolean | null;
}

export interface Snapshot {
  info: ElementInfo;
  /** The element's targets that check out, best first. */
  targets: Target[];
  /** Targets that match the element and others like it, with how many they match (for a count check). */
  groups: { target: Target; count: number }[];
  /** The point, from the element's top-left corner. */
  spot: { x: number; y: number };
}

// Runs in the page. The element under the point, inside open shadow roots, raised to the nearest
// control (a click on a button's icon is a click on the button).
const READ = `({ x, y, testIdAttr }) => {
  let el = document.elementFromPoint(x, y);
  while (el && el.shadowRoot) {
    const inner = el.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === el) break;
    el = inner;
  }
  if (!el) return null;
  const sel = 'button,a[href],input,select,textarea,label,summary,option,[role],[contenteditable=""],[contenteditable="true"],[' + testIdAttr + ']';
  const t = el.closest(sel) || el;
  const clean = (s) => (s || "").replace(/\\s+/g, " ").trim();
  const r = t.getBoundingClientRect();
  return {
    el: t,
    info: {
      tag: t.tagName.toLowerCase(),
      type: t.getAttribute("type"),
      role: t.getAttribute("role"),
      testId: t.getAttribute(testIdAttr),
      ariaLabel: t.getAttribute("aria-label"),
      labels: t.labels ? Array.from(t.labels).map((l) => clean(l.innerText)).filter(Boolean) : [],
      placeholder: t.getAttribute("placeholder"),
      alt: t.getAttribute("alt"),
      title: t.getAttribute("title"),
      text: clean(t.innerText || t.textContent),
      id: t.getAttribute("id"),
      name: t.getAttribute("name"),
      href: t.hasAttribute("href"),
      box: { x: r.x, y: r.y, width: r.width, height: r.height },
      value: "value" in t && typeof t.value === "string" ? t.value : null,
      checked: "checked" in t && typeof t.checked === "boolean" ? t.checked : null,
    },
  };
}`;

const INPUT_ROLES: Record<string, string> = { checkbox: "checkbox", radio: "radio", button: "button", submit: "button", reset: "button", range: "slider", number: "spinbutton", search: "searchbox" };
const NAMED_BY_TEXT = new Set(["button", "link", "heading", "tab", "menuitem", "option", "cell", "listitem", "checkbox", "radio"]);

/** The element's ARIA role: its `role` attribute, or the one its tag implies. */
export function roleOf(i: ElementInfo): string | null {
  if (i.role) return i.role.split(/\s+/)[0]!;
  switch (i.tag) {
    case "button":
    case "summary":
      return "button";
    case "a":
      return i.href ? "link" : null;
    case "select":
      return "combobox";
    case "textarea":
      return "textbox";
    case "img":
      return i.alt ? "img" : null;
    case "input":
      return INPUT_ROLES[i.type ?? "text"] ?? (i.type === "hidden" ? null : "textbox");
    case "li":
      return "listitem";
    case "option":
      return "option";
    default:
      return /^h[1-6]$/.test(i.tag) ? "heading" : null;
  }
}

const short = (s: string | null | undefined, max = 60): string | null => {
  const v = (s ?? "").trim();
  return v.length > 0 && v.length <= max ? v : null;
};
/** An id or name written by hand, not generated (`radix-:r3:`, `ember1234`). */
const readable = (s: string | null): s is string => !!s && /^[A-Za-z][\w-]*$/.test(s) && !/\d{3,}/.test(s);

/** The targets worth trying for an element, in the order Playwright's recorder prefers them. */
export function candidatesOf(i: ElementInfo): Target[] {
  const out: TargetMap[] = [];
  if (i.testId) out.push({ testId: i.testId });
  const role = roleOf(i);
  const label = short(i.ariaLabel) ?? short(i.labels[0]);
  if (role) {
    const name = short(i.ariaLabel) ?? short(i.labels[0]) ?? (NAMED_BY_TEXT.has(role) ? short(i.text) : null) ?? short(i.alt) ?? short(i.title);
    if (name) out.push({ role, name });
  }
  if (label) out.push({ label });
  if (short(i.placeholder)) out.push({ placeholder: short(i.placeholder)! });
  if (short(i.alt)) out.push({ alt: short(i.alt)! });
  const isField = i.tag === "input" || i.tag === "textarea" || i.tag === "select";
  if (!isField && short(i.text, 50)) out.push({ text: short(i.text, 50)! });
  if (short(i.title)) out.push({ title: short(i.title)! });
  const css: Target[] = [];
  if (readable(i.id)) css.push(`#${i.id}`);
  if (isField && readable(i.name)) css.push(`${i.tag}[name="${i.name}"]`);
  return [...out, ...css];
}

/**
 * Targets that match exactly one element, and that element is `el`. A target that matches several
 * gets the element's text as a filter (`testId: todo-title` + `hasText: Buy milk`), and failing
 * that its position among them (`nth`), which comes last because it breaks when the list changes.
 */
async function checked(page: Page, el: ElementHandle, targets: readonly Target[], text: string | null): Promise<{ targets: Target[]; groups: Snapshot["groups"] }> {
  const asMap = (t: Target): TargetMap => (typeof t === "string" ? { css: t } : t);
  const groups: Snapshot["groups"] = [];
  const unique = async (t: Target, group = false): Promise<"one" | "many" | "no"> => {
    try {
      const loc = locate(page, t);
      const n = await loc.count();
      if (n === 0) return "no";
      if (n > 1) {
        if (!(await loc.evaluateAll((els, h) => els.includes(h), el))) return "no";
        if (group) groups.push({ target: t, count: n });
        return "many";
      }
      return (await loc.evaluate((e, h) => e === h, el, { timeout: 1000 })) ? "one" : "no";
    } catch {
      return "no";
    }
  };
  const nthOf = async (t: Target): Promise<Target | null> => {
    try {
      const i = await locate(page, t).evaluateAll((els, h) => els.indexOf(h), el);
      return i >= 0 ? { ...asMap(t), nth: i } : null;
    } catch {
      return null;
    }
  };
  const results = await Promise.all(
    targets.map(async (t): Promise<{ good?: Target; last?: Target }> => {
      const u = await unique(t, true);
      if (u === "one") return { good: t };
      if (u === "no") return {};
      const m = asMap(t);
      if (text && m.text === undefined && m.hasText === undefined) {
        const filtered: TargetMap = { ...m, hasText: text };
        if ((await unique(filtered)) === "one") return { good: filtered };
      }
      const nth = await nthOf(t);
      return nth ? { last: nth } : {};
    }),
  );
  return {
    targets: [...results.flatMap((r) => (r.good ? [r.good] : [])), ...results.flatMap((r) => (r.last ? [r.last] : [])).slice(0, 1)],
    groups: targets.flatMap((t) => groups.filter((g) => g.target === t)),
  };
}

/** The element under a viewport point and its targets, or null when there is none. */
export async function snapshotAt(page: Page, x: number, y: number, testIdAttr = "data-testid"): Promise<(Snapshot & { element: ElementHandle }) | null> {
  const handle = await page.evaluateHandle(`(${READ})(${JSON.stringify({ x, y, testIdAttr })})`);
  try {
    const element = (await handle.getProperty("el")).asElement();
    if (!element) return null;
    const info = (await (await handle.getProperty("info")).jsonValue()) as ElementInfo;
    const { targets, groups } = await checked(page, element, candidatesOf(info), short(info.text, 50));
    return { info, targets, groups, element, spot: { x: Math.round(x - info.box.x), y: Math.round(y - info.box.y) } };
  } finally {
    await handle.dispose().catch(() => undefined);
  }
}

/** The same target twice? (Key order doesn't count.) */
export function sameTarget(a: Target, b: Target): boolean {
  const norm = (t: Target): string => (typeof t === "string" ? t : JSON.stringify(Object.fromEntries(Object.entries(t).sort(([x], [y]) => x.localeCompare(y)))));
  return norm(a) === norm(b);
}

/** `first`, then every target in `more` that isn't already there. */
export function withAlternatives(first: Target, more: readonly Target[]): Target[] {
  const out: Target[] = [first];
  for (const t of more) if (!out.some((o) => sameTarget(o, t))) out.push(t);
  return out;
}
