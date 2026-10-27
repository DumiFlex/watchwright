import path from "node:path";
import type { FrameLocator, Locator, Page } from "playwright";
import { expect } from "playwright/test";
import { StepError, type Helpers, type Outcome, type ParamValues, type TestBody } from "../api.js";
import { summarize, type Step, type StepArgs } from "./steps.js";
import type { Target, TargetMap, TextMatch } from "./targets.js";

// Runs YAML steps through `h`. Each step is one `h.step`, so it is a pause point and shows live,
// in the log and in the step timeline. A step that fails names its line in the YAML file as the
// top frame of the error's stack, so the attempt page points at it like at a line of code.

export interface StepEnv {
  page: Page;
  h: Helpers;
  params: ParamValues;
  packDir: string;
  /** The YAML file, absolute. */
  file: string;
  attempt: number;
  attempts: number;
  last: boolean;
  child?: (id: string) => Promise<Outcome>;
}

const ACTION_TIMEOUT = 15_000;

/** The browser globals `scroll` reads inside the page (this package doesn't load the DOM types). */
interface PageWindow {
  scrollTo(x: number, y: number): void;
  document: { documentElement: { scrollHeight: number } };
}

/** Values read from `${env.…}`, kept out of logs and error messages. */
class Secrets {
  readonly values = new Set<string>();
  mask(s: string): string {
    let out = s;
    for (const v of this.values) if (v.length > 0) out = out.split(v).join("•••");
    return out;
  }
}

export class VariableError extends StepError {}

function lookup(expr: string, env: StepEnv, secrets: Secrets): unknown {
  const [root, ...rest] = expr.trim().split(".");
  const key = rest.join(".");
  switch (root) {
    case "params":
      if (!(key in env.params)) throw new VariableError(`\${params.${key}}: the pack has no param "${key}".`);
      return env.params[key];
    case "saved": {
      const v = env.h.load(key);
      if (v === undefined) throw new VariableError(`\${saved.${key}}: nothing was saved as "${key}" (does this test list the test that saves it in needs?).`);
      return v;
    }
    case "env": {
      const v = process.env[key];
      if (v === undefined) throw new VariableError(`\${env.${key}}: the environment variable ${key} isn't set on the machine running Watchwright.`);
      secrets.values.add(v);
      return v;
    }
    case "attempt":
      return env.attempt;
    case "attempts":
      return env.attempts;
    case "last":
      return env.last;
    default:
      throw new VariableError(`\${${expr}} isn't a variable. Use params.…, saved.…, env.…, attempt, attempts or last.`);
  }
}

/** Fills in `${…}` variables. A string that is one variable keeps the variable's type; `$${` is a literal `${`. */
export function interpolate(value: unknown, env: StepEnv, secrets: Secrets): unknown {
  if (typeof value === "string") {
    const whole = /^\$\{([^}]+)\}$/.exec(value);
    if (whole) return lookup(whole[1]!, env, secrets);
    return value.replace(/\$?\$\{([^}]+)\}/g, (m, expr: string) => (m.startsWith("$$") ? m.slice(1) : String(lookup(expr, env, secrets))));
  }
  if (Array.isArray(value)) return value.map((v) => interpolate(v, env, secrets));
  if (value && typeof value === "object") {
    // Nested steps resolve their own variables when they run.
    if (isStep(value)) return value;
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, interpolate(v, env, secrets)]));
  }
  return value;
}

const isStep = (v: object): v is Step => "name" in v && "args" in v && "line" in v;

function toRegex(m: { regex: string; flags?: string }): RegExp {
  return new RegExp(m.regex, m.flags);
}

function matchOf(m: TextMatch): string | RegExp {
  return typeof m === "string" ? m : toRegex(m);
}

type Scope = Page | FrameLocator | Locator;

/** Turns a target into a Playwright locator. */
export function locate(page: Page, target: Target, scope: Scope = page): Locator {
  if (typeof target === "string") return scope.locator(target);
  const t: TargetMap = target;
  let within: Scope = scope;
  if (t.frame !== undefined) within = locate(page, t.frame, within).contentFrame();
  if (t.within !== undefined) within = locate(page, t.within, within);
  const exact = t.exact === undefined ? {} : { exact: t.exact };
  let loc: Locator;
  if (t.role !== undefined) {
    const opts: Parameters<Page["getByRole"]>[1] = { ...exact };
    if (t.name !== undefined) opts.name = matchOf(t.name);
    for (const k of ["checked", "disabled", "expanded", "pressed", "selected", "includeHidden"] as const) if (t[k] !== undefined) opts[k] = t[k];
    if (t.level !== undefined) opts.level = t.level;
    loc = within.getByRole(t.role as Parameters<Page["getByRole"]>[0], opts);
  } else if (t.label !== undefined) loc = within.getByLabel(matchOf(t.label), exact);
  else if (t.placeholder !== undefined) loc = within.getByPlaceholder(matchOf(t.placeholder), exact);
  else if (t.text !== undefined) loc = within.getByText(matchOf(t.text), exact);
  else if (t.alt !== undefined) loc = within.getByAltText(matchOf(t.alt), exact);
  else if (t.title !== undefined) loc = within.getByTitle(matchOf(t.title), exact);
  else if (t.testId !== undefined) loc = within.getByTestId(t.testId);
  else loc = within.locator(t.css ?? "*");
  if (t.hasText !== undefined || t.hasNotText !== undefined || t.has !== undefined) {
    loc = loc.filter({
      ...(t.hasText !== undefined ? { hasText: matchOf(t.hasText) } : {}),
      ...(t.hasNotText !== undefined ? { hasNotText: matchOf(t.hasNotText) } : {}),
      ...(t.has !== undefined ? { has: locate(page, t.has) } : {}),
    });
  }
  if (t.nth !== undefined) loc = loc.nth(t.nth);
  else if (t.first) loc = loc.first();
  else if (t.last) loc = loc.last();
  return loc;
}

/** Turns a Playwright timeout into a StepError (the attempt is broken, not failed), like `h` does. */
async function act<T>(what: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") throw new StepError(`Couldn't ${what}: ${err.message.split("\n")[0]}`);
    throw err;
  }
}

/**
 * The first number in a text: "Total: 1,234.50 EUR" is 1234.5, "3 items left" is 3, "12,5 s" is
 * 12.5. With both "," and ".", the last one is the decimal point; a lone "," followed by exactly
 * three digits groups thousands.
 */
export function firstNumber(text: string): number {
  const m = /-?\d(?:[\d.,\s\u00a0]*\d)?/.exec(text);
  if (!m) throw new StepError(`No number in "${text.slice(0, 80)}".`);
  let n = m[0].replace(/[\s\u00a0]/g, "");
  const dot = n.lastIndexOf(".");
  const comma = n.lastIndexOf(",");
  if (dot >= 0 && comma >= 0) n = dot > comma ? n.replace(/,/g, "") : n.replace(/\./g, "").replace(",", ".");
  else if (comma >= 0) n = /^-?\d{1,3}(,\d{3})+$/.test(n) ? n.replace(/,/g, "") : n.replace(",", ".");
  const value = Number(n);
  if (!Number.isFinite(value)) throw new StepError(`No number in "${text.slice(0, 80)}".`);
  return value;
}

/** An element's text, or its value for inputs, text areas and selects. */
async function readText(loc: Locator): Promise<string> {
  return act("read the text", () =>
    loc.evaluate((el) => {
      const e = el as unknown as { tagName: string; value?: string; innerText: string };
      return ["INPUT", "TEXTAREA", "SELECT"].includes(e.tagName) ? String(e.value ?? "") : e.innerText;
    }, undefined, { timeout: ACTION_TIMEOUT }),
  );
}

const str = (v: unknown) => (typeof v === "string" ? v : String(v));

async function runOne(step: Step, env: StepEnv, secrets: Secrets): Promise<void> {
  const a = interpolate(step.args, env, secrets) as StepArgs;
  const { h, page } = env;
  const at = (v: unknown) => locate(page, v as Target);
  const timeout = (fallback = ACTION_TIMEOUT) => (typeof a.timeout === "number" ? a.timeout : fallback);
  switch (step.name) {
    case "goto":
      return h.goto(str(a.url), a.waitUntil ? { waitUntil: a.waitUntil as "load" } : undefined);
    case "back":
      await page.goBack();
      return;
    case "reload":
      await page.reload();
      return;
    case "clear": {
      const what = (a.what as string | undefined) ?? "all";
      if (what !== "storage") await page.context().clearCookies();
      if (what !== "cookies")
        await page.evaluate(() => {
          const w = globalThis as unknown as { localStorage?: { clear(): void }; sessionStorage?: { clear(): void } };
          try {
            w.localStorage?.clear();
            w.sessionStorage?.clear();
          } catch {
            // about:blank and some sandboxed pages have no storage
          }
        });
      return;
    }
    case "click":
      if (a.button && a.button !== "left") {
        await act(`click ${summarize(step)}`, () => at(a.target).click({ button: a.button as "right", timeout: timeout() }));
        return;
      }
      return h.click(at(a.target), { ...(a.done !== undefined ? { done: at(a.done) } : {}), timeout: timeout() });
    case "dblclick":
      await act("double-click", () => at(a.target).dblclick({ timeout: timeout() }));
      return;
    case "fill":
      return h.fill(at(a.target), str(a.value));
    case "type":
      await act("type", () => at(a.target).pressSequentially(str(a.text), { timeout: ACTION_TIMEOUT, ...(typeof a.delay === "number" ? { delay: a.delay } : {}) }));
      return;
    case "press":
      return a.target === undefined ? h.press(str(a.key)) : h.press(at(a.target), str(a.key));
    case "check":
      await act("tick", () => at(a.target).check({ timeout: ACTION_TIMEOUT }));
      return;
    case "uncheck":
      await act("untick", () => at(a.target).uncheck({ timeout: ACTION_TIMEOUT }));
      return;
    case "select": {
      const options = (Array.isArray(a.option) ? a.option : [a.option]).map(str);
      await act("pick an option", () => at(a.target).selectOption(options, { timeout: ACTION_TIMEOUT }));
      return;
    }
    case "hover":
      await act("hover", () => at(a.target).hover({ timeout: ACTION_TIMEOUT }));
      return;
    case "upload": {
      const files = (Array.isArray(a.files) ? a.files : [a.files]).map((f) => path.resolve(env.packDir, str(f)));
      await act("set the files", () => at(a.target).setInputFiles(files, { timeout: ACTION_TIMEOUT }));
      return;
    }
    case "scroll": {
      if (a.to === undefined) {
        await act("scroll into view", () => at(a.target).scrollIntoViewIfNeeded({ timeout: ACTION_TIMEOUT }));
        return;
      }
      const top = a.to === "top";
      if (a.target === undefined)
        await page.evaluate((up) => {
          const w = globalThis as unknown as PageWindow;
          w.scrollTo(0, up ? 0 : w.document.documentElement.scrollHeight);
        }, top);
      else await at(a.target).evaluate((el, up) => el.scrollTo(0, up ? 0 : el.scrollHeight), top);
      return;
    }
    case "wait":
      return h.wait(Number(a.ms));
    case "waitFor":
      await act(`see ${summarize(step).replace(/^Wait for /, "")}`, () => at(a.target).first().waitFor({ state: (a.state as "visible") ?? "visible", timeout: timeout(30_000) }));
      return;
    case "idle":
      return h.idle({ ...(typeof a.timeout === "number" ? { timeout: a.timeout } : {}), ...(typeof a.quietMs === "number" ? { quietMs: a.quietMs } : {}) });
    case "expect":
      return check(a, env);
    case "shot":
      return h.shot(str(a.name), { ...(a.fullPage === true ? { fullPage: true } : {}), ...(a.target !== undefined ? { target: at(a.target) } : {}) });
    case "scrollShots":
      await h.scrollShots(str(a.name), { ...(a.target !== undefined ? { target: at(a.target) } : {}), ...(typeof a.max === "number" ? { max: a.max } : {}) });
      return;
    case "keepText":
      await h.keepText(str(a.name), a.target !== undefined ? at(a.target) : { text: secrets.mask(str(a.text)) });
      return;
    case "note":
      return h.note(secrets.mask(str(a.text)));
    case "log":
      return h.log(secrets.mask(str(a.text)));
    case "flag":
      return h.flag(str(a.name), a.detail === undefined ? undefined : secrets.mask(str(a.detail)));
    case "metric": {
      const value = a.target !== undefined ? firstNumber(await readText(at(a.target))) : Number(a.value);
      return h.metric(str(a.name), value, a.unit === undefined ? undefined : str(a.unit));
    }
    case "save":
      return h.save(str(a.key), a.target !== undefined ? await readText(at(a.target)) : a.value);
    case "info":
      return h.info(str(a.key), a.value as string);
    case "step":
      return runList(a.steps as Step[], env, secrets);
    case "if": {
      let holds: boolean;
      const wait = typeof a.timeout === "number" ? a.timeout : 0;
      if (a.has !== undefined) holds = await h.has(at(a.has), wait);
      else if (a.hasNot !== undefined) holds = !(await h.has(at(a.hasNot), wait));
      else holds = (a.equals as unknown[]).map(str).every((v, _, all) => v === all[0]);
      h.log(`${summarize(step)}: ${holds ? "yes" : "no"}`);
      return runList((holds ? a.then : (a.else ?? [])) as Step[], env, secrets);
    }
    case "repeat": {
      if (typeof a.times === "number") {
        for (let i = 0; i < a.times; i++) await runList(a.steps as Step[], env, secrets);
        return;
      }
      const max = typeof a.max === "number" ? a.max : 20;
      for (let i = 0; i < max; i++) {
        if (await h.has(at(a.until))) return;
        await runList(a.steps as Step[], env, secrets);
      }
      if (await h.has(at(a.until))) return;
      throw new StepError(`${summarize(step)}: still not there after ${max} rounds.`);
    }
    case "child":
      if (!env.child) throw new StepError("child only works inside a test.");
      await env.child(str(a.id));
      return;
    case "skip":
      return h.skip(secrets.mask(str(a.reason)));
    case "use": {
      const name = str(a.helper);
      const fn = (h as unknown as Record<string, unknown>)[name];
      if (typeof fn !== "function") throw new StepError(`The pack has no helper "${name}". Code packs add helpers with \`helpers\` in the pack file.`);
      await (fn as (...args: unknown[]) => unknown).apply(h, (a.args as unknown[] | undefined) ?? []);
      return;
    }
    default:
      throw new StepError(`"${step.name}" isn't a step.`);
  }
}

async function check(a: StepArgs, env: StepEnv): Promise<void> {
  const opts = { timeout: typeof a.timeout === "number" ? a.timeout : 5000 };
  const neg = a.not === true;
  if (a.url !== undefined) {
    const want = typeof a.url === "string" ? new URL(a.url, env.h.baseURL ?? env.page.url()).href : toRegex(a.url as { regex: string });
    const e = expect(env.page);
    await (neg ? e.not : e).toHaveURL(want, opts);
    return;
  }
  if (a.title !== undefined) {
    const e = expect(env.page);
    await (neg ? e.not : e).toHaveTitle(matchOf(a.title as TextMatch), opts);
    return;
  }
  const base = expect(locate(env.page, a.target as Target));
  const e = neg ? base.not : base;
  if (a.visible !== undefined) await e.toBeVisible(opts);
  else if (a.hidden !== undefined) await e.toBeHidden(opts);
  else if (a.text !== undefined) await e.toHaveText(matchOf(a.text as TextMatch), opts);
  else if (a.containsText !== undefined) await e.toContainText(matchOf(a.containsText as TextMatch), opts);
  else if (a.value !== undefined) await e.toHaveValue(matchOf(a.value as TextMatch), opts);
  else if (a.count !== undefined) await e.toHaveCount(Number(a.count), opts);
  else if (a.checked !== undefined) await e.toBeChecked(opts);
  else if (a.enabled !== undefined) await e.toBeEnabled(opts);
  else if (a.disabled !== undefined) await e.toBeDisabled(opts);
}

const PLACED = Symbol("yaml-step-placed");

/** Puts the YAML line on top of the stack, once (the innermost step wins). */
function place(err: unknown, step: Step, file: string, secrets: Secrets): unknown {
  if (!(err instanceof Error)) return err;
  const marked = err as Error & { [PLACED]?: boolean };
  err.message = secrets.mask(err.message);
  if (marked[PLACED]) return err;
  marked[PLACED] = true;
  const lines = (err.stack ?? "").split("\n");
  const head = lines.findIndex((l) => /^\s+at /.test(l));
  const frame = `    at ${step.name} (${file}:${step.line}:${step.col})`;
  const rest = head < 0 ? [] : lines.slice(head);
  err.stack = `${err.name}: ${err.message}\n${frame}${rest.length ? `\n${secrets.mask(rest.join("\n"))}` : ""}`;
  return err;
}

async function runList(steps: readonly Step[], env: StepEnv, secrets: Secrets): Promise<void> {
  for (const step of steps) {
    const title = secrets.mask(summarize(step));
    try {
      await env.h.step(title, () => runOne(step, env, secrets));
    } catch (err) {
      throw place(err, step, env.file, secrets);
    }
  }
}

/** Runs a list of steps (a test's, or pack.yaml's setup and hooks). */
export function runSteps(steps: readonly Step[], env: StepEnv): Promise<void> {
  return runList(steps, env, new Secrets());
}

/** A test body that runs the steps. */
export function yamlBody(steps: readonly Step[], file: string): TestBody {
  return async (ctx) => {
    await runSteps(steps, { page: ctx.page, h: ctx.h, params: ctx.params, packDir: ctx.packDir, file, attempt: ctx.attempt, attempts: ctx.attempts, last: ctx.last, child: ctx.child });
  };
}
