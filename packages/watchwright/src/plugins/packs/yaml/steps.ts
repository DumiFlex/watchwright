import { bool, int, list, num, obj, oneOrMore, req, str, type Prop, type Shape } from "./shape.js";
import { describeTarget, type Target, type TextMatch } from "./targets.js";

// Every step a YAML test can use. Each is one verb with its fields, and runs as one `h` step, so a
// pause lands between steps and each shows in the log and the step timeline. run.ts runs them,
// to-code.ts writes them as code, and the docs site has a section for each (a test checks).

export type StepGroup = "go" | "act" | "wait" | "check" | "keep" | "shape";

export interface StepDef {
  name: string;
  group: StepGroup;
  /** One line for the docs, hints and the Steps view. */
  doc: string;
  /** The field a plain value fills: `- goto: /cart` is `- goto: { url: /cart }`. */
  short?: string;
  /** May be written with no value: `- reload`. */
  bare?: boolean;
  fields: Record<string, Prop>;
  /** Checks across fields; returns what's wrong. */
  check?: (args: StepArgs) => string | null;
  /** What the step does, in plain words, for the log, the timeline and the Steps view. */
  summary: (args: StepArgs) => string;
}

export type StepArgs = Record<string, unknown>;

/** A parsed step: its name and fields, and where it is in the file. */
export interface Step {
  name: string;
  args: StepArgs;
  line: number;
  col: number;
  /** The comment above the step, if any. */
  comment?: string;
}

const target = (doc = "The element."): Shape => ({ t: "target", doc });
const match = (doc: string): Shape => ({ t: "match", doc });
const steps = (doc = "The steps."): Shape => ({ t: "steps", doc });
const timeout = int("Time limit in ms (default 15000).", { min: 0 });
const position = obj({ x: req(num("Pixels from the element's left edge.")), y: req(num("Pixels from the element's top edge.")) }, "A spot inside the element, `{ x, y }` in pixels from its top-left corner, to use instead of its middle (for canvases, maps and image pickers).");
const at = (v: unknown) => (v && typeof v === "object" ? ` at ${(v as { x: number }).x}, ${(v as { y: number }).y}` : "");
const t = (v: unknown) => describeTarget(v as Target);
const m = (v: unknown) => (typeof v === "string" ? `"${v}"` : `/${(v as { regex: string }).regex}/`);
const s = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));

/** The checks `expect` knows, each with the field that holds its expected value. */
export const EXPECT_CHECKS = ["visible", "hidden", "text", "containsText", "value", "count", "checked", "enabled", "disabled", "url", "title"] as const;
const PAGE_CHECKS = new Set(["url", "title"]);

export const STEPS: readonly StepDef[] = [
  {
    name: "goto",
    group: "go",
    doc: "Opens a URL. A relative URL is joined to the pack's site.baseURL.",
    short: "url",
    fields: { url: req(str("The URL.")), waitUntil: str("When the page counts as loaded (default load).", { enum: ["load", "domcontentloaded", "networkidle", "commit"] }) },
    summary: (a) => `Go to ${s(a.url)}`,
  },
  { name: "back", group: "go", doc: "Goes back in the browser history.", bare: true, fields: {}, summary: () => "Go back" },
  { name: "reload", group: "go", doc: "Reloads the page.", bare: true, fields: {}, summary: () => "Reload the page" },
  {
    name: "clear",
    group: "go",
    doc: "Clears cookies, the open site's local and session storage, or both (the default), for a clean start.",
    short: "what",
    bare: true,
    fields: { what: str("What to clear (default all).", { enum: ["cookies", "storage", "all"] }) },
    summary: (a) => (a.what === "cookies" ? "Clear cookies" : a.what === "storage" ? "Clear the site's storage" : "Clear cookies and storage"),
  },

  {
    name: "click",
    group: "act",
    doc: "Clicks an element. With `done`, waits for that element to show, which also tells a click that landed from one that didn't.",
    short: "target",
    fields: {
      target: req(target()),
      done: target("An element that shows once the click worked."),
      button: str("Which mouse button (default left).", { enum: ["left", "right", "middle"] }),
      position,
      timeout,
    },
    summary: (a) => `Click ${t(a.target)}${at(a.position)}`,
  },
  { name: "dblclick", group: "act", doc: "Double-clicks an element.", short: "target", fields: { target: req(target()), position, timeout }, summary: (a) => `Double-click ${t(a.target)}${at(a.position)}` },
  {
    name: "fill",
    group: "act",
    doc: "Replaces the text in an input, text area or editable element.",
    fields: { target: req(target("The field.")), value: req({ t: "scalar", doc: "The text to put in." }) },
    summary: (a) => `Fill ${t(a.target)} with "${s(a.value)}"`,
  },
  {
    name: "type",
    group: "act",
    doc: "Types text key by key, for fields that react to each key (search as you type).",
    fields: { target: req(target("The field.")), text: req(str("The text.")), delay: int("Pause between keys in ms.", { min: 0 }) },
    summary: (a) => `Type "${s(a.text)}" into ${t(a.target)}`,
  },
  {
    name: "press",
    group: "act",
    doc: "Presses a key or a combination (Enter, Escape, Control+A). With a target, on that element.",
    short: "key",
    fields: { key: req(str("The key: Enter, Tab, ArrowDown, Control+S, …")), target: target("Press on this element instead of the page.") },
    summary: (a) => (a.target === undefined ? `Press ${s(a.key)}` : `Press ${s(a.key)} on ${t(a.target)}`),
  },
  { name: "check", group: "act", doc: "Ticks a checkbox or picks a radio button.", short: "target", fields: { target: req(target()) }, summary: (a) => `Tick ${t(a.target)}` },
  { name: "uncheck", group: "act", doc: "Unticks a checkbox.", short: "target", fields: { target: req(target()) }, summary: (a) => `Untick ${t(a.target)}` },
  {
    name: "select",
    group: "act",
    doc: "Picks options in a select element, by value or label.",
    fields: { target: req(target("The select element.")), option: req(oneOrMore(str(), "The option, or a list of them.")) },
    summary: (a) => `Pick ${Array.isArray(a.option) ? a.option.map((o) => `"${s(o)}"`).join(", ") : `"${s(a.option)}"`} in ${t(a.target)}`,
  },
  { name: "hover", group: "act", doc: "Moves the mouse over an element.", short: "target", fields: { target: req(target()), position }, summary: (a) => `Hover over ${t(a.target)}${at(a.position)}` },
  {
    name: "upload",
    group: "act",
    doc: "Sets the files of a file input. Paths are relative to the pack folder.",
    fields: { target: req(target("The file input.")), files: req(oneOrMore(str(), "A file, or a list of files.")) },
    summary: (a) => `Upload ${Array.isArray(a.files) ? a.files.join(", ") : s(a.files)} to ${t(a.target)}`,
  },
  {
    name: "scroll",
    group: "act",
    doc: "Scrolls the page or an element to the top or bottom, or scrolls an element into view.",
    short: "to",
    fields: { to: str("top or bottom.", { enum: ["top", "bottom"] }), target: target("The element to scroll (with `to`) or to bring into view.") },
    check: (a) => (a.to === undefined && a.target === undefined ? "scroll needs `to`, `target` or both." : null),
    summary: (a) => (a.to === undefined ? `Scroll ${t(a.target)} into view` : `Scroll ${a.target === undefined ? "the page" : t(a.target)} to the ${s(a.to)}`),
  },

  { name: "wait", group: "wait", doc: "Waits a number of milliseconds. Time spent paused doesn't count.", short: "ms", fields: { ms: req(int("Milliseconds.", { min: 0 })) }, summary: (a) => `Wait ${s(a.ms)} ms` },
  {
    name: "waitFor",
    group: "wait",
    doc: "Waits until an element is in a state (default visible).",
    short: "target",
    fields: { target: req(target()), state: str("visible, hidden, attached or detached.", { enum: ["visible", "hidden", "attached", "detached"] }), timeout: int("Time limit in ms (default 30000).", { min: 0 }) },
    summary: (a) => `Wait for ${t(a.target)}${a.state && a.state !== "visible" ? ` to be ${s(a.state)}` : ""}`,
  },
  {
    name: "idle",
    group: "wait",
    doc: "Waits until the network is quiet and the pack's idle check (if it has one) says the app is idle.",
    bare: true,
    fields: { timeout: int("Time limit in ms (default 30000).", { min: 0 }), quietMs: int("How long the network must be quiet (default 500).", { min: 0 }) },
    summary: () => "Wait until the page is idle",
  },

  {
    name: "expect",
    group: "check",
    doc: "Checks the page. Give one check; with `not`, the opposite. Retries until it passes or times out (default 5000 ms). A failed check fails the attempt.",
    fields: {
      target: target("The element to check (not needed for url and title)."),
      visible: bool("The element is visible."),
      hidden: bool("The element is hidden or gone."),
      text: match("The element's whole text."),
      containsText: match("Text the element contains."),
      value: match("An input's value."),
      count: int("How many elements match.", { min: 0 }),
      checked: bool("A checkbox is ticked."),
      enabled: bool("The element is enabled."),
      disabled: bool("The element is disabled."),
      url: match("The page URL (relative to the site's baseURL, or a regex)."),
      title: match("The page title."),
      not: bool("Check the opposite."),
      timeout: int("How long to retry in ms (default 5000).", { min: 0 }),
    },
    check(a) {
      const checks = EXPECT_CHECKS.filter((k) => a[k] !== undefined);
      if (checks.length === 0) return `expect needs one check: ${EXPECT_CHECKS.join(", ")}.`;
      if (checks.length > 1) return `expect checks one thing at a time, not ${checks.join(" and ")}. Use one expect step for each.`;
      const c = checks[0]!;
      if (PAGE_CHECKS.has(c) && a.target !== undefined) return `${c} checks the page, so it takes no target.`;
      if (!PAGE_CHECKS.has(c) && a.target === undefined) return `${c} needs a target.`;
      if (["visible", "hidden", "checked", "enabled", "disabled"].includes(c) && a[c] === false) return `Write \`not: true\` instead of \`${c}: false\`.`;
      return null;
    },
    summary(a) {
      const c = EXPECT_CHECKS.find((k) => a[k] !== undefined) ?? "visible";
      const neg = a.not === true;
      const el = a.target === undefined ? "" : t(a.target);
      switch (c) {
        case "url":
          return `Check the URL ${neg ? "isn't" : "is"} ${m(a.url)}`;
        case "title":
          return `Check the title ${neg ? "isn't" : "is"} ${m(a.title)}`;
        case "text":
          return `Check ${el} ${neg ? "doesn't read" : "reads"} ${m(a.text)}`;
        case "containsText":
          return `Check ${el} ${neg ? "doesn't contain" : "contains"} ${m(a.containsText)}`;
        case "value":
          return `Check ${el} ${neg ? "doesn't hold" : "holds"} ${m(a.value)}`;
        case "count":
          return `Check there ${neg ? "aren't" : "are"} ${s(a.count)} of ${el}`;
        default:
          return `Check ${el} is ${neg ? "not " : ""}${c}`;
      }
    },
  },

  {
    name: "shot",
    group: "keep",
    doc: "Saves a screenshot of the page, the whole page, or one element.",
    short: "name",
    fields: { name: req(str("The screenshot's name.")), fullPage: bool("The whole page, not only what's in view."), target: target("Only this element.") },
    summary: (a) => `Screenshot "${s(a.name)}"`,
  },
  {
    name: "scrollShots",
    group: "keep",
    doc: "Scrolls the page (or an element) top to bottom and saves a screenshot per screen.",
    short: "name",
    fields: { name: req(str("The screenshots' name.")), target: target("Scroll this element instead of the page."), max: int("At most this many (default 20).", { min: 1 }) },
    summary: (a) => `Screenshots "${s(a.name)}" while scrolling`,
  },
  {
    name: "keepText",
    group: "keep",
    doc: "Saves an element's text (or the given text) with the attempt.",
    fields: { name: req(str("The text's name.")), target: target("The element to read."), text: str("Text to keep instead of an element's.") },
    check: (a) => (a.target === undefined && a.text === undefined ? "keepText needs `target` or `text`." : a.target !== undefined && a.text !== undefined ? "keepText takes `target` or `text`, not both." : null),
    summary: (a) => `Keep the text "${s(a.name)}"`,
  },
  { name: "note", group: "keep", doc: "A note for the people who review the result.", short: "text", fields: { text: req(str()) }, summary: (a) => `Note: ${s(a.text)}` },
  { name: "log", group: "keep", doc: "A line in the attempt's log.", short: "text", fields: { text: req(str()) }, summary: (a) => `Log: ${s(a.text)}` },
  {
    name: "flag",
    group: "keep",
    doc: "Raises a flag the pack declares in `flags`.",
    short: "name",
    fields: { name: req(str("The flag.")), detail: str("What happened.") },
    summary: (a) => `Flag ${s(a.name)}`,
  },
  {
    name: "metric",
    group: "keep",
    doc: "Saves a number: the given value, or the first number in an element's text.",
    fields: { name: req(str("The metric's name.")), value: { t: "scalar", doc: "The number." }, target: target("Read the number from this element."), unit: str("The unit: s, ms, items, …") },
    check: (a) => (a.target === undefined && a.value === undefined ? "metric needs `value` or `target`." : a.target !== undefined && a.value !== undefined ? "metric takes `value` or `target`, not both." : null),
    summary: (a) => `Metric "${s(a.name)}"`,
  },
  {
    name: "save",
    group: "keep",
    doc: "Keeps a value for later tests (read it as ${saved.key}): the given value, or an element's text. Kept from a test's last attempt.",
    fields: { key: req(str("The name to keep it under.")), value: { t: "any", doc: "The value." }, target: target("Keep this element's text.") },
    check: (a) => (a.target === undefined && a.value === undefined ? "save needs `value` or `target`." : a.target !== undefined && a.value !== undefined ? "save takes `value` or `target`, not both." : null),
    summary: (a) => `Save "${s(a.key)}"`,
  },
  {
    name: "info",
    group: "keep",
    doc: "Saves a fact about the whole run (an app version, a mode), shown on the run page.",
    fields: { key: req(str("The fact's name.")), value: req({ t: "scalar", doc: "Its value." }) },
    summary: (a) => `Run info "${s(a.key)}"`,
  },

  {
    name: "step",
    group: "shape",
    doc: "A titled group of steps, shown as one step live and in the timeline.",
    fields: { title: req(str("The title.")), steps: req(steps()) },
    summary: (a) => s(a.title),
  },
  {
    name: "if",
    group: "shape",
    doc: "Runs `then` when the condition holds, else `else`. Conditions: `has` (an element is visible), `hasNot`, or `equals` (two values).",
    fields: {
      has: target("Holds when this element is visible."),
      hasNot: target("Holds when this element is not visible."),
      equals: list({ t: "scalar" }, "Holds when the two values are the same text."),
      timeout: int("With has or hasNot: wait up to this long in ms for the element (default 0: look once).", { min: 0 }),
      then: req(steps("The steps when it holds.")),
      else: steps("The steps when it doesn't."),
    },
    check(a) {
      const conds = ["has", "hasNot", "equals"].filter((k) => a[k] !== undefined);
      if (conds.length !== 1) return "if needs one condition: has, hasNot or equals.";
      if (a.equals !== undefined && (a.equals as unknown[]).length !== 2) return "equals takes two values: [a, b].";
      return null;
    },
    summary: (a) =>
      a.has !== undefined ? `If ${t(a.has)} shows` : a.hasNot !== undefined ? `If ${t(a.hasNot)} doesn't show` : `If ${(a.equals as unknown[]).map(s).join(" is ")}`,
  },
  {
    name: "repeat",
    group: "shape",
    doc: "Runs steps a number of times, or until an element shows (at most `max` times, default 20).",
    fields: { times: int("How many times.", { min: 0 }), until: target("Stop once this element shows."), max: int("With until: give up after this many rounds.", { min: 1 }), steps: req(steps()) },
    check: (a) => (a.times === undefined && a.until === undefined ? "repeat needs `times` or `until`." : a.times !== undefined && a.until !== undefined ? "repeat takes `times` or `until`, not both." : null),
    summary: (a) => (a.times !== undefined ? `Repeat ${s(a.times)} times` : `Repeat until ${t(a.until)} shows`),
  },
  { name: "child", group: "shape", doc: "Runs a child test (one with `inside: <this test>`) here, as its own attempt.", short: "id", fields: { id: req(str("The child test's id.")) }, summary: (a) => `Run ${s(a.id)} here` },
  { name: "skip", group: "shape", doc: "Ends the attempt as skipped, with the reason.", short: "reason", fields: { reason: req(str()) }, summary: (a) => `Skip: ${s(a.reason)}` },
  {
    name: "use",
    group: "shape",
    doc: "Calls one of the pack's own helpers (from `helpers` in a code pack file) with arguments.",
    short: "helper",
    fields: { helper: req(str("The helper's name.")), args: list({ t: "any" }, "Its arguments.") },
    summary: (a) => `Use ${s(a.helper)}`,
  },
];

export const STEP_BY_NAME: ReadonlyMap<string, StepDef> = new Map(STEPS.map((d) => [d.name, d]));

export function summarize(step: Pick<Step, "name" | "args">): string {
  const def = STEP_BY_NAME.get(step.name);
  return def ? def.summary(step.args) : step.name;
}

/** Test metadata in a YAML test, as in code (docs/plan.md, section 5). */
export const TEST_META: Record<string, Prop> = {
  id: req(str("Letters, digits, dots, dashes or underscores, unique in the pack.", { pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$" })),
  title: str("A short title."),
  section: str("The section it's listed under."),
  description: str("What the test does and what a good result looks like, shown with its results and review."),
  tags: list(str()),
  runs: { t: "union", of: [int(undefined, { min: 0 }), obj({ by: req(str("The param it depends on.")), default: int(undefined, { min: 0 }) }, undefined, { extra: int(undefined, { min: 0 }) })], doc: "How many attempts: a number, or one per value of a param: `{ by: lang, de: 2, default: 1 }`." },
  needs: list(str(), "Tests whose saved values this test uses; they run first."),
  inside: oneOrMore(str(), "The parent test (or tests) whose `child` step runs this one."),
  timeout: int("Time limit per attempt in ms.", { min: 0 }),
  review: { t: "any", doc: "Criteria this test adds to the pack's rubric (`add`) or drops from it (`drop`)." },
};

export function textOf(m: TextMatch): string {
  return typeof m === "string" ? m : m.regex;
}

/** The shapes the web app's Steps view needs to build a form, by step name. */
export function fieldsOf(name: string): Record<string, Prop> {
  return STEP_BY_NAME.get(name)?.fields ?? {};
}

