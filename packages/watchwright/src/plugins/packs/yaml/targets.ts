import { bool, int, obj, str, type Shape } from "./shape.js";

// A target is an element on the page, in Playwright's words: a selector string, or a map with one
// base kind (`role`, `label`, `text`, …) plus filters. These are the locator kinds Playwright's
// recorder produces, so recorded and hand-written steps look the same.

export type TextMatch = string | { regex: string; flags?: string };

export interface TargetMap {
  role?: string;
  name?: TextMatch;
  exact?: boolean;
  checked?: boolean;
  disabled?: boolean;
  expanded?: boolean;
  pressed?: boolean;
  selected?: boolean;
  level?: number;
  includeHidden?: boolean;
  label?: TextMatch;
  placeholder?: TextMatch;
  text?: TextMatch;
  alt?: TextMatch;
  title?: TextMatch;
  testId?: string;
  css?: string;
  nth?: number;
  first?: boolean;
  last?: boolean;
  hasText?: TextMatch;
  hasNotText?: TextMatch;
  has?: Target;
  within?: Target;
  frame?: Target;
}

export type Target = string | TargetMap;

/** The keys that pick the element; a target map has exactly one. */
export const BASE_KINDS = ["role", "label", "placeholder", "text", "alt", "title", "testId", "css"] as const;
export type BaseKind = (typeof BASE_KINDS)[number];

const match = (doc: string): Shape => ({ t: "match", doc });
const ROLE_ONLY = ["name", "checked", "disabled", "expanded", "pressed", "selected", "level", "includeHidden"] as const;

export const TARGET_MAP: Shape = obj(
  {
    role: str("An ARIA role: button, link, textbox, checkbox, heading, …"),
    name: match("With `role`: the accessible name."),
    exact: bool("Match the name or text exactly (case and whole string)."),
    checked: bool("With `role`: checked or not."),
    disabled: bool("With `role`: disabled or not."),
    expanded: bool("With `role`: expanded or not."),
    pressed: bool("With `role`: pressed or not."),
    selected: bool("With `role`: selected or not."),
    level: int("With `role: heading`: the heading level.", { min: 1, max: 6 }),
    includeHidden: bool("With `role`: also match hidden elements."),
    label: match("A form control by its label."),
    placeholder: match("An input by its placeholder."),
    text: match("An element by its text."),
    alt: match("An image by its alt text."),
    title: match("An element by its title attribute."),
    testId: str("An element by its test id (`data-testid` unless the pack sets another)."),
    css: str("A CSS selector."),
    nth: int("Pick the n-th match, counting from 0; -1 is the last."),
    first: bool("Pick the first match."),
    last: bool("Pick the last match."),
    hasText: match("Keep matches that contain this text."),
    hasNotText: match("Keep matches that don't contain this text."),
    has: { t: "target", doc: "Keep matches that contain this element." },
    within: { t: "target", doc: "Look only inside this element." },
    frame: { t: "target", doc: "Look inside this iframe." },
  },
  "An element on the page.",
  {
    check(v) {
      const kinds = BASE_KINDS.filter((k) => v[k] !== undefined);
      if (kinds.length === 0) return `A target needs one of ${BASE_KINDS.join(", ")}.`;
      if (kinds.length > 1) return `A target has one of ${BASE_KINDS.join(", ")}, not ${kinds.join(" and ")}.`;
      if (kinds[0] !== "role") {
        const roleOnly = ROLE_ONLY.filter((k) => v[k] !== undefined);
        if (roleOnly.length > 0) return `${roleOnly.join(", ")} only go with role.`;
      }
      if ([v.first, v.last, v.nth !== undefined].filter(Boolean).length > 1) return "Use one of nth, first and last.";
      return null;
    },
  },
);

function quote(m: TextMatch): string {
  return typeof m === "string" ? `"${m}"` : `/${m.regex}/${m.flags ?? ""}`;
}

/** A target in a few words, for step summaries: `button "Save"`, `label "Email"`, `#save`. */
export function describeTarget(t: Target): string {
  if (typeof t === "string") return t;
  let s: string;
  if (t.role !== undefined) s = t.name !== undefined ? `${t.role} ${quote(t.name)}` : t.role;
  else if (t.label !== undefined) s = `label ${quote(t.label)}`;
  else if (t.placeholder !== undefined) s = `placeholder ${quote(t.placeholder)}`;
  else if (t.text !== undefined) s = `text ${quote(t.text)}`;
  else if (t.alt !== undefined) s = `image ${quote(t.alt)}`;
  else if (t.title !== undefined) s = `title ${quote(t.title)}`;
  else if (t.testId !== undefined) s = `test id "${t.testId}"`;
  else s = t.css ?? "?";
  if (t.hasText !== undefined) s += ` with ${quote(t.hasText)}`;
  if (t.has !== undefined) s += ` with ${describeTarget(t.has)}`;
  if (t.nth !== undefined) s += t.nth === -1 ? " (last)" : ` (#${t.nth + 1})`;
  if (t.first) s += " (first)";
  if (t.last) s += " (last)";
  if (t.within !== undefined) s += ` in ${describeTarget(t.within)}`;
  if (t.frame !== undefined) s += ` in frame ${describeTarget(t.frame)}`;
  return s;
}
