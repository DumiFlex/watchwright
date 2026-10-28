// The Steps view's forms, as plain functions: a target as a kind and a value (and back), text
// that may be a regex, and the controls a field gets. StepForm.vue and TargetField.vue draw them.
import { BASE_KINDS, EXPECT_CHECKS, type BaseKind, type Prop, type Shape, type Target, type TargetMap, type TextMatch } from "./yamlsteps";

/** `selector` is a plain Playwright selector string; the others are the map kinds. */
export type TargetKind = BaseKind | "selector";

export const TARGET_KINDS: { value: TargetKind; label: string }[] = [
  { value: "role", label: "Role" },
  { value: "label", label: "Label" },
  { value: "placeholder", label: "Placeholder" },
  { value: "text", label: "Text" },
  { value: "testId", label: "Test id" },
  { value: "alt", label: "Alt text" },
  { value: "title", label: "Title" },
  { value: "css", label: "CSS" },
  { value: "selector", label: "Selector" },
];

export interface TargetParts {
  kind: TargetKind;
  /** The kind's value: the role, the label text, the selector, … */
  value: string;
  /** With `role`: the accessible name. */
  name: string;
  exact: boolean;
  /** Keys the form doesn't show (filters such as `within` or `nth`), kept as they are. */
  extra: Record<string, unknown>;
}

/** Text that may be a regex, as one string: `Save` or `/^Save/i`. */
export function matchText(m: TextMatch | undefined): string {
  if (m === undefined) return "";
  return typeof m === "string" ? m : `/${m.regex}/${m.flags ?? ""}`;
}

export function parseMatch(s: string): TextMatch {
  const m = /^\/(.+)\/([dgimsuvy]*)$/.exec(s);
  if (!m) return s;
  return m[2] ? { regex: m[1]!, flags: m[2] } : { regex: m[1]! };
}

export function targetParts(t: Target | undefined): TargetParts {
  if (t === undefined || typeof t === "string") return { kind: "selector", value: t ?? "", name: "", exact: false, extra: {} };
  const kind = BASE_KINDS.find((k) => t[k] !== undefined) ?? "css";
  const { [kind]: v, name, exact, ...rest } = t as Record<string, unknown>;
  return { kind, value: kind === "role" || kind === "testId" || kind === "css" ? String(v ?? "") : matchText(v as TextMatch | undefined), name: matchText(name as TextMatch | undefined), exact: exact === true, extra: rest };
}

export function targetOf(p: TargetParts): Target {
  if (p.kind === "selector") return p.value;
  const out: Record<string, unknown> = {};
  out[p.kind] = p.kind === "role" || p.kind === "testId" || p.kind === "css" ? p.value : parseMatch(p.value);
  if (p.kind === "role" && p.name) out.name = parseMatch(p.name);
  if (p.exact && p.kind !== "css" && p.kind !== "testId") out.exact = true;
  return { ...out, ...p.extra } as TargetMap;
}

export type Control = "target" | "text" | "match" | "number" | "choice" | "toggle" | "list" | "steps" | "json";

/** The control a field's shape gets in the form. */
export function controlOf(s: Shape): Control {
  switch (s.t) {
    case "target":
      return "target";
    case "match":
      return "match";
    case "string":
      return s.enum ? "choice" : "text";
    case "scalar":
      return "text";
    case "number":
    case "integer":
      return "number";
    case "boolean":
      return "toggle";
    case "steps":
      return "steps";
    case "array":
      return s.items.t === "string" ? "list" : "json";
    case "union":
      return s.of.some((x) => x.t === "array") && s.of.some((x) => x.t === "string") ? "list" : s.of.some((x) => x.t === "integer" || x.t === "number") ? "number" : "json";
    default:
      return "json";
  }
}

/** A field's value as the text in its box. */
export function fieldText(v: unknown, c: Control): string {
  if (v === undefined || v === null) return "";
  if (c === "match") return matchText(v as TextMatch);
  if (c === "list") return Array.isArray(v) ? v.map(String).join(", ") : String(v);
  if (c === "json") return JSON.stringify(v);
  return String(v);
}

/** The text in a box as the field's value; empty means the field is left out. */
export function fieldValue(text: string, c: Control, prop: Prop): unknown {
  const t = text.trim();
  if (t === "") return prop.required ? "" : undefined;
  if (/\$\{[^}]+\}/.test(t) && c !== "match") return t; // a variable stands for any type
  switch (c) {
    case "number": {
      const n = Number(t);
      return Number.isFinite(n) ? n : t;
    }
    case "match":
      return parseMatch(text);
    case "list": {
      const parts = t.split(",").map((x) => x.trim()).filter(Boolean);
      return prop.t === "union" && parts.length === 1 ? parts[0] : parts;
    }
    case "json":
      try {
        return JSON.parse(t) as unknown;
      } catch {
        return t;
      }
    default:
      return text;
  }
}

/** The check an expect step makes (`text`, `visible`, …). */
export function expectCheck(args: Record<string, unknown>): (typeof EXPECT_CHECKS)[number] {
  return EXPECT_CHECKS.find((k) => args[k] !== undefined) ?? "visible";
}

export const CHECK_LABELS: Record<(typeof EXPECT_CHECKS)[number], string> = {
  visible: "is visible",
  hidden: "is hidden",
  text: "has the text",
  containsText: "contains the text",
  value: "has the value",
  count: "count is",
  checked: "is ticked",
  enabled: "is enabled",
  disabled: "is disabled",
  url: "page URL is",
  title: "page title is",
};

/** The expect step's args with another check, keeping target, not and timeout. */
export function withCheck(args: Record<string, unknown>, check: (typeof EXPECT_CHECKS)[number]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of ["target", "not", "timeout"]) if (args[k] !== undefined && !(k === "target" && (check === "url" || check === "title"))) out[k] = args[k];
  const flag = ["visible", "hidden", "checked", "enabled", "disabled"].includes(check);
  out[check] = flag ? true : check === "count" ? 1 : "";
  return out;
}
