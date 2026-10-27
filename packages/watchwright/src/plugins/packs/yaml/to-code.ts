import { EXPECT_CHECKS, type Step, type StepArgs } from "./steps.js";
import type { Target, TextMatch } from "./targets.js";
import type { YamlTest } from "./parse.js";

// Writes YAML steps as TypeScript: "Convert to code" for a test that outgrew YAML, and Record into
// a code test. Each step becomes the `h` or `expect` call it runs as, so the code behaves the same.

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** A JS expression for a `${…}` variable. */
function variable(expr: string): string {
  const [root, ...rest] = expr.trim().split(".");
  const key = rest.join(".");
  const prop = (obj: string) => (IDENT.test(key) ? `${obj}.${key}` : `${obj}[${JSON.stringify(key)}]`);
  switch (root) {
    case "params":
      return prop("params");
    case "saved":
      return `h.load(${JSON.stringify(key)})`;
    case "env":
      return prop("process.env");
    default:
      return root ?? "undefined";
  }
}

/** A JS literal for a YAML value, with `${…}` variables as template literals. */
export function lit(value: unknown): string {
  if (typeof value === "string") {
    const whole = /^\$\{([^}]+)\}$/.exec(value);
    if (whole) return variable(whole[1]!);
    if (!/\$\{/.test(value)) return JSON.stringify(value);
    const parts = value.split(/(\$?\$\{[^}]+\})/);
    const body = parts
      .map((p) => {
        if (p.startsWith("$${")) return "\\" + p.slice(1);
        const m = /^\$\{([^}]+)\}$/.exec(p);
        return m ? `\${${variable(m[1]!)}}` : p.replace(/[\\`]/g, "\\$&").replace(/\$\{/g, "\\${");
      })
      .join("");
    return `\`${body}\``;
  }
  if (Array.isArray(value)) return `[${value.map(lit).join(", ")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return "{}";
    return `{ ${entries.map(([k, v]) => `${IDENT.test(k) ? k : JSON.stringify(k)}: ${lit(v)}`).join(", ")} }`;
  }
  return JSON.stringify(value);
}

function matchLit(m: TextMatch): string {
  return typeof m === "string" ? lit(m) : `/${m.regex.replace(/\//g, "\\/")}/${m.flags ?? ""}`;
}

/** A Playwright locator expression for a target. */
export function locatorCode(target: Target, scope = "page"): string {
  if (typeof target === "string") return `${scope}.locator(${lit(target)})`;
  const t = target;
  let within = scope;
  if (t.frame !== undefined) within = `${locatorCode(t.frame, within)}.contentFrame()`;
  if (t.within !== undefined) within = locatorCode(t.within, within);
  const opts = (o: Record<string, string>) => {
    const e = Object.entries(o);
    return e.length ? `, { ${e.map(([k, v]) => `${k}: ${v}`).join(", ")} }` : "";
  };
  const exact: Record<string, string> = t.exact === undefined ? {} : { exact: String(t.exact) };
  let code: string;
  if (t.role !== undefined) {
    const o: Record<string, string> = {};
    if (t.name !== undefined) o.name = matchLit(t.name);
    Object.assign(o, exact);
    for (const k of ["checked", "disabled", "expanded", "pressed", "selected", "includeHidden"] as const) if (t[k] !== undefined) o[k] = String(t[k]);
    if (t.level !== undefined) o.level = String(t.level);
    code = `${within}.getByRole(${lit(t.role)}${opts(o)})`;
  } else if (t.label !== undefined) code = `${within}.getByLabel(${matchLit(t.label)}${opts(exact)})`;
  else if (t.placeholder !== undefined) code = `${within}.getByPlaceholder(${matchLit(t.placeholder)}${opts(exact)})`;
  else if (t.text !== undefined) code = `${within}.getByText(${matchLit(t.text)}${opts(exact)})`;
  else if (t.alt !== undefined) code = `${within}.getByAltText(${matchLit(t.alt)}${opts(exact)})`;
  else if (t.title !== undefined) code = `${within}.getByTitle(${matchLit(t.title)}${opts(exact)})`;
  else if (t.testId !== undefined) code = `${within}.getByTestId(${lit(t.testId)})`;
  else code = `${within}.locator(${lit(t.css ?? "*")})`;
  const filter: Record<string, string> = {};
  if (t.hasText !== undefined) filter.hasText = matchLit(t.hasText);
  if (t.hasNotText !== undefined) filter.hasNotText = matchLit(t.hasNotText);
  if (t.has !== undefined) filter.has = locatorCode(t.has);
  if (Object.keys(filter).length) code += `.filter({ ${Object.entries(filter).map(([k, v]) => `${k}: ${v}`).join(", ")} })`;
  if (t.nth !== undefined) code += `.nth(${t.nth})`;
  else if (t.first) code += ".first()";
  else if (t.last) code += ".last()";
  return code;
}

const loc = (v: unknown) => locatorCode(v as Target);
/** Reads an element's text, or its value for form fields, as the YAML steps do. */
const textOf = (v: unknown) =>
  `await ${loc(v)}.evaluate((el) => (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement ? el.value : (el as HTMLElement).innerText))`;
const n = (v: unknown) => (typeof v === "number" ? String(v) : `Number(${lit(v)})`);

function expectCode(a: StepArgs): string {
  const not = a.not === true ? ".not" : "";
  const opts = typeof a.timeout === "number" ? `, { timeout: ${a.timeout} }` : "";
  const bare = typeof a.timeout === "number" ? `{ timeout: ${a.timeout} }` : "";
  if (a.url !== undefined) {
    const want = typeof a.url === "string" ? `new URL(${lit(a.url)}, h.baseURL ?? page.url()).href` : matchLit(a.url as TextMatch);
    return `await expect(page)${not}.toHaveURL(${want}${opts});`;
  }
  if (a.title !== undefined) return `await expect(page)${not}.toHaveTitle(${matchLit(a.title as TextMatch)}${opts});`;
  const c = EXPECT_CHECKS.find((k) => a[k] !== undefined) ?? "visible";
  const e = `await expect(${loc(a.target)})${not}`;
  switch (c) {
    case "visible":
      return `${e}.toBeVisible(${bare});`;
    case "hidden":
      return `${e}.toBeHidden(${bare});`;
    case "text":
      return `${e}.toHaveText(${matchLit(a.text as TextMatch)}${opts});`;
    case "containsText":
      return `${e}.toContainText(${matchLit(a.containsText as TextMatch)}${opts});`;
    case "value":
      return `${e}.toHaveValue(${matchLit(a.value as TextMatch)}${opts});`;
    case "count":
      return `${e}.toHaveCount(${n(a.count)}${opts});`;
    case "checked":
      return `${e}.toBeChecked(${bare});`;
    case "enabled":
      return `${e}.toBeEnabled(${bare});`;
    default:
      return `${e}.toBeDisabled(${bare});`;
  }
}

/** The code for one step, as lines (without indentation). */
export function stepCode(step: Step): string[] {
  const a = step.args;
  const lines = (s: string) => [s];
  const block = (head: string, body: readonly Step[], tail = "}") => [head, ...stepsCode(body).map((l) => `  ${l}`), tail];
  const named = (o: Record<string, unknown>) => {
    const e = Object.entries(o).filter(([, v]) => v !== undefined);
    return e.length ? `, { ${e.map(([k, v]) => `${k}: ${v}`).join(", ")} }` : "";
  };
  const pos = a.position === undefined ? undefined : lit(a.position);
  switch (step.name) {
    case "goto":
      return lines(`await h.goto(${lit(a.url)}${a.waitUntil ? `, { waitUntil: ${lit(a.waitUntil)} }` : ""});`);
    case "back":
      return lines("await page.goBack();");
    case "reload":
      return lines("await page.reload();");
    case "clear": {
      const what = (a.what as string | undefined) ?? "all";
      return [
        ...(what !== "storage" ? ["await page.context().clearCookies();"] : []),
        ...(what !== "cookies" ? ["await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });"] : []),
      ];
    }
    case "click":
      if (a.button && a.button !== "left") return lines(`await ${loc(a.target)}.click(${named({ button: lit(a.button), position: pos }).slice(2) || "{}"});`);
      return lines(`await h.click(${loc(a.target)}${named({ done: a.done === undefined ? undefined : loc(a.done), position: pos, timeout: a.timeout })});`);
    case "dblclick":
      return lines(`await ${loc(a.target)}.dblclick(${named({ position: pos }).slice(2)});`);
    case "fill":
      return lines(`await h.fill(${loc(a.target)}, ${typeof a.value === "string" ? lit(a.value) : lit(String(a.value))});`);
    case "type":
      return lines(`await ${loc(a.target)}.pressSequentially(${lit(a.text)}${a.delay !== undefined ? `, { delay: ${a.delay} }` : ""});`);
    case "press":
      return lines(a.target === undefined ? `await h.press(${lit(a.key)});` : `await h.press(${loc(a.target)}, ${lit(a.key)});`);
    case "check":
      return lines(`await ${loc(a.target)}.check();`);
    case "uncheck":
      return lines(`await ${loc(a.target)}.uncheck();`);
    case "select":
      return lines(`await ${loc(a.target)}.selectOption(${lit(a.option)});`);
    case "hover":
      return lines(`await ${loc(a.target)}.hover(${named({ position: pos }).slice(2)});`);
    case "upload": {
      const files = (Array.isArray(a.files) ? a.files : [a.files]).map((f) => `path.join(packDir, ${lit(f)})`);
      return lines(`await ${loc(a.target)}.setInputFiles([${files.join(", ")}]);`);
    }
    case "scroll":
      if (a.to === undefined) return lines(`await ${loc(a.target)}.scrollIntoViewIfNeeded();`);
      if (a.target === undefined) return lines(`await page.evaluate(() => window.scrollTo(0, ${a.to === "top" ? "0" : "document.documentElement.scrollHeight"}));`);
      return lines(`await ${loc(a.target)}.evaluate((el) => el.scrollTo(0, ${a.to === "top" ? "0" : "el.scrollHeight"}));`);
    case "wait":
      return lines(`await h.wait(${n(a.ms)});`);
    case "waitFor":
      return lines(`await ${loc(a.target)}.first().waitFor({ state: ${lit(a.state ?? "visible")}${a.timeout !== undefined ? `, timeout: ${a.timeout}` : ""} });`);
    case "idle":
      return lines(`await h.idle(${a.timeout !== undefined || a.quietMs !== undefined ? named({ timeout: a.timeout, quietMs: a.quietMs }).slice(2) : ""});`);
    case "expect":
      return lines(expectCode(a));
    case "shot":
      return lines(`await h.shot(${lit(a.name)}${named({ fullPage: a.fullPage, target: a.target === undefined ? undefined : loc(a.target) })});`);
    case "scrollShots":
      return lines(`await h.scrollShots(${lit(a.name)}${named({ target: a.target === undefined ? undefined : loc(a.target), max: a.max })});`);
    case "keepText":
      return lines(`await h.keepText(${lit(a.name)}, ${a.target !== undefined ? loc(a.target) : `{ text: ${lit(a.text)} }`});`);
    case "note":
      return lines(`h.note(${lit(a.text)});`);
    case "log":
      return lines(`h.log(${lit(a.text)});`);
    case "flag":
      return lines(`h.flag(${lit(a.name)}${a.detail !== undefined ? `, ${lit(a.detail)}` : ""});`);
    case "metric": {
      const value = a.target !== undefined ? `firstNumber(${textOf(a.target)})` : n(a.value);
      return lines(`h.metric(${lit(a.name)}, ${value}${a.unit !== undefined ? `, ${lit(a.unit)}` : ""});`);
    }
    case "save":
      return lines(`h.save(${lit(a.key)}, ${a.target !== undefined ? textOf(a.target) : lit(a.value)});`);
    case "info":
      return lines(`h.info(${lit(a.key)}, ${lit(a.value)});`);
    case "step":
      return block(`await h.step(${lit(a.title)}, async () => {`, a.steps as Step[], "});");
    case "if": {
      const wait = typeof a.timeout === "number" ? `, ${a.timeout}` : "";
      const cond =
        a.has !== undefined
          ? `await h.has(${loc(a.has)}${wait})`
          : a.hasNot !== undefined
            ? `!(await h.has(${loc(a.hasNot)}${wait}))`
            : `String(${lit((a.equals as unknown[])[0])}) === String(${lit((a.equals as unknown[])[1])})`;
      const out = block(`if (${cond}) {`, a.then as Step[]);
      if (a.else !== undefined) {
        out.pop();
        out.push(...block("} else {", a.else as Step[]));
      }
      return out;
    }
    case "repeat":
      if (a.times !== undefined) return block(`for (let i = 0; i < ${n(a.times)}; i++) {`, a.steps as Step[]);
      return [
        `for (let i = 0; !(await h.has(${loc(a.until)})); i++) {`,
        `  if (i >= ${typeof a.max === "number" ? a.max : 20}) throw new StepError(${lit(`Still no ${JSON.stringify(a.until)} after ${typeof a.max === "number" ? a.max : 20} rounds.`)});`,
        ...stepsCode(a.steps as Step[]).map((l) => `  ${l}`),
        "}",
      ];
    case "child":
      return lines(`await child(${lit(a.id)});`);
    case "skip":
      return lines(`h.skip(${lit(a.reason)});`);
    case "use": {
      const name = String(a.helper);
      const call = IDENT.test(name) ? `h.${name}` : `h[${JSON.stringify(name)}]`;
      return lines(`await ${call}(${((a.args as unknown[] | undefined) ?? []).map(lit).join(", ")});`);
    }
    default:
      return lines(`// ${step.name}: no code for this step`);
  }
}

export function stepsCode(steps: readonly Step[]): string[] {
  const out: string[] = [];
  for (const s of steps) {
    if (s.comment) out.push(...s.comment.split("\n").map((l) => `//${l.startsWith(" ") ? "" : " "}${l}`));
    out.push(...stepCode(s));
  }
  return out;
}

function uses(steps: readonly Step[], test: (s: Step) => boolean): boolean {
  return steps.some((s) => test(s) || ["steps", "then", "else"].some((k) => Array.isArray(s.args[k]) && uses(s.args[k] as Step[], test)));
}

/** A whole test file for YAML tests, with the imports its code needs. */
export function testsToCode(tests: readonly YamlTest[]): string {
  const all = tests.flatMap((t) => t.steps);
  const needPath = uses(all, (s) => s.name === "upload");
  const named = [
    ...(uses(all, (s) => s.name === "metric" && s.args.target !== undefined) ? ["firstNumber"] : []),
    ...(uses(all, (s) => s.name === "repeat" && s.args.until !== undefined) ? ["StepError"] : []),
    "test",
  ];
  const head = [...(needPath ? [`import path from "node:path";`] : []), `import { ${named.join(", ")} } from "watchwright";`];
  const bodies = tests.map((t) => {
    const code = stepsCode(t.steps).join("\n");
    const vars = ["page", "h", "expect", "params", "packDir", "attempt", "attempts", "last", "child"].filter((v) => new RegExp(`\\b${v}\\b`).test(code) || (v === "h" && /\bh\./.test(code)));
    const meta = lit(t.meta);
    return [`test(${lit(t.id)}, ${meta}, async ({ ${vars.join(", ")} }) => {`, ...code.split("\n").filter((l) => l !== "").map((l) => `  ${l}`), "});"].join("\n");
  });
  return `${head.join("\n")}\n\n${bodies.join("\n\n")}\n`;
}
