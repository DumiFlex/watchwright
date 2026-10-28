import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { BrowserContext, Locator, Page } from "playwright";
import type { RunControl } from "../../jobs/control.js";
import { contentTypeOf, safeRelative, type AttemptRecorder } from "../../jobs/recorder.js";
import type { BrowserSession } from "../../session/session.js";
import { SkipTest, StepError, type ClickOptions, type FlagKind, type Helpers, type Target } from "../packs/api.js";

// The core `h` helper (docs/plan.md, section 5), ported from the bench robot's Bot without the
// Wildcard parts. Every call starts at a checkpoint, so a pause lands between actions.

export interface HelperRuntime {
  page: Page;
  context: BrowserContext;
  baseURL: string | undefined;
  control: RunControl;
  recorder: AttemptRecorder;
  session: BrowserSession;
  flagKinds: Record<string, FlagKind>;
  idleCheck: ((page: Page) => boolean | Promise<boolean>) | undefined;
  chapters: boolean;
  save(key: string, value: unknown): void;
  load(key: string): unknown;
  info(key: string, value: string | number | boolean): void;
  onStep(title: string | null): void;
  onFlag(flag: { name: string; kind: FlagKind; detail: string | null }): void;
}

const DEFAULT_TIMEOUT = 15_000;

/** The few browser globals `scrollShots` reads inside the page (this package doesn't load the DOM types). */
interface BrowserWindow {
  scrollY: number;
  innerHeight: number;
  scrollTo(x: number, y: number): void;
  document: { documentElement: { scrollHeight: number } };
}

function describe(target: Target): string {
  return typeof target === "string" ? target : target.toString();
}

export function createHelpers(rt: HelperRuntime, extend?: (h: Helpers) => Record<string, unknown>): Helpers {
  const { page, control, recorder } = rt;
  const loc = (t: Target): Locator => (typeof t === "string" ? page.locator(t) : t);
  const enter = async () => {
    await control.checkpoint("attempt");
    rt.session.setActive(page);
  };
  const steps: string[] = [];

  const until = async (check: () => boolean | Promise<boolean>, timeout: number): Promise<boolean> => {
    const end = Date.now() + timeout;
    for (;;) {
      if (await Promise.resolve(check()).catch(() => false)) return true;
      if (Date.now() >= end) return false;
      await new Promise((r) => setTimeout(r, 100));
    }
  };

  const h: Helpers = {
    get page() {
      return page;
    },
    get context() {
      return rt.context;
    },
    baseURL: rt.baseURL,

    async goto(url, options) {
      await enter();
      const full = rt.baseURL ? new URL(url, rt.baseURL).href : url;
      await page.goto(full, { waitUntil: options?.waitUntil ?? "load" });
    },

    async click(target, options: ClickOptions = {}) {
      await enter();
      const timeout = options.timeout ?? DEFAULT_TIMEOUT;
      const done = options.done;
      const isDone = done === undefined ? null : typeof done === "function" ? done : () => loc(done).isVisible();
      try {
        await loc(target).click({ timeout, ...(options.position ? { position: options.position } : {}) });
      } catch (err) {
        // Firefox sometimes reports a click as timed out although it landed. When the test says how
        // to tell the click worked, trust that check over the timeout.
        if (!isDone || !(err instanceof Error) || err.name !== "TimeoutError" || !(await until(isDone, 2000))) {
          if (err instanceof Error && err.name === "TimeoutError") throw new StepError(`Couldn't click ${describe(target)}: ${err.message.split("\n")[0]}`);
          throw err;
        }
        recorder.addLog("warn", `The click on ${describe(target)} timed out but landed.`);
        return;
      }
      if (isDone && !(await until(isDone, timeout))) throw new StepError(`Clicked ${describe(target)}, but it had no effect within ${timeout} ms.`);
    },

    async fill(target, value) {
      await enter();
      try {
        await loc(target).fill(value, { timeout: DEFAULT_TIMEOUT });
      } catch (err) {
        if (err instanceof Error && err.name === "TimeoutError") throw new StepError(`Couldn't fill ${describe(target)}: ${err.message.split("\n")[0]}`);
        throw err;
      }
    },

    async press(targetOrKey, key) {
      await enter();
      if (key === undefined) {
        if (typeof targetOrKey !== "string") throw new StepError("press(locator) needs a key: press(locator, \"Enter\").");
        await page.keyboard.press(targetOrKey);
      } else await loc(targetOrKey).press(key, { timeout: DEFAULT_TIMEOUT });
    },

    async has(target, timeout = 0) {
      await enter();
      if (timeout <= 0) return loc(target).first().isVisible();
      return loc(target)
        .first()
        .waitFor({ state: "visible", timeout })
        .then(
          () => true,
          () => false,
        );
    },

    async step(title, fn) {
      await enter();
      steps.push(title);
      rt.onStep(steps.join(" › "));
      recorder.addLog("info", `Step: ${title}`);
      const record = recorder.beginStep(title, steps.length - 1);
      let ok = false;
      if (rt.chapters) await page.screencast.showChapter(title, { duration: 1200 }).catch(() => undefined);
      try {
        const out = await fn();
        ok = true;
        return out;
      } catch (err) {
        if (err instanceof Error && !err.message.startsWith(`[${title}]`) && err.name !== "StopNow" && err.name !== "AttemptAborted") {
          err.message = `[${title}] ${err.message}`;
        }
        throw err;
      } finally {
        recorder.endStep(record, ok);
        steps.pop();
        rt.onStep(steps.length > 0 ? steps.join(" › ") : null);
        await control.checkpoint("attempt");
      }
    },

    async idle(options = {}) {
      await enter();
      const timeout = options.timeout ?? 30_000;
      const quietMs = options.quietMs ?? 500;
      const quiet = await until(() => rt.session.network().quietForMs >= quietMs, timeout);
      if (!quiet) throw new StepError(`The page didn't go quiet within ${timeout} ms (${rt.session.network().inflight} requests still open).`);
      if (rt.idleCheck && !(await until(() => rt.idleCheck!(page), timeout))) throw new StepError(`The app didn't report idle within ${timeout} ms.`);
    },

    async wait(ms) {
      await enter();
      await control.sleep(ms);
    },

    async shot(name, options = {}) {
      await enter();
      const file = recorder.numberedName(name, ".png");
      const data = options.target ? await loc(options.target).screenshot() : await page.screenshot({ fullPage: options.fullPage ?? false });
      recorder.write("shot", name, file, data, "image/png");
    },

    async scrollShots(name, options = {}) {
      await enter();
      const max = options.max ?? 20;
      const scroller = options.target ? loc(options.target) : null;
      const metrics = async () =>
        scroller
          ? scroller.evaluate((el) => ({ top: el.scrollTop, height: el.scrollHeight, view: el.clientHeight }))
          : page.evaluate(() => {
              const w = globalThis as unknown as BrowserWindow;
              return { top: w.scrollY, height: w.document.documentElement.scrollHeight, view: w.innerHeight };
            });
      const scrollTo = async (top: number) =>
        scroller ? scroller.evaluate((el, y) => el.scrollTo(0, y), top) : page.evaluate((y) => (globalThis as unknown as BrowserWindow).scrollTo(0, y), top);
      await scrollTo(0);
      let n = 0;
      for (; n < max; n++) {
        await control.checkpoint("attempt");
        const file = recorder.numberedName(`${name}-${n + 1}`, ".png");
        const data = scroller ? await scroller.screenshot() : await page.screenshot();
        recorder.write("shot", `${name} ${n + 1}`, file, data, "image/png", { set: name });
        const m = await metrics();
        if (m.top + m.view >= m.height - 1) {
          n++;
          break;
        }
        await scrollTo(m.top + Math.max(1, Math.floor(m.view * 0.9)));
        await page.waitForTimeout(150);
      }
      return n;
    },

    async keepText(name, from) {
      await enter();
      const text = typeof from === "object" && "text" in from && typeof from.text === "string" ? from.text : await loc(from as Target).innerText({ timeout: DEFAULT_TIMEOUT });
      recorder.texts[name] = text;
      recorder.write("text", name, recorder.numberedName(name, ".txt"), text, "text/plain; charset=utf-8");
      return text;
    },

    async file(name, data, contentType) {
      await enter();
      const rel = safeRelative(name);
      if (!rel) throw new StepError(`"${name}" isn't a usable file name.`);
      let body: string | Buffer;
      if (typeof data === "string") body = data;
      else if (data instanceof Uint8Array) body = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
      else {
        try {
          body = readFileSync(data.path);
        } catch (e) {
          throw new StepError(`Couldn't read ${data.path} to save it as "${rel}": ${(e as Error).message}`);
        }
      }
      // A name used again gets -2, -3, … before its extension, so nothing saved earlier is lost.
      const ext = path.posix.extname(rel);
      const stem = rel.slice(0, rel.length - ext.length);
      let saved = rel;
      for (let n = 2; existsSync(path.join(recorder.dir, "files", ...saved.split("/"))); n++) saved = `${stem}-${n}${ext}`;
      recorder.write("file", saved, path.join("files", ...saved.split("/")), body, contentType ?? contentTypeOf(saved));
      return saved;
    },

    log(message) {
      recorder.addLog("info", message);
    },

    note(message) {
      recorder.notes.push(message);
      recorder.addLog("info", `Note: ${message}`);
    },

    flag(name, detail) {
      const declared = name in rt.flagKinds;
      const kind: FlagKind = rt.flagKinds[name] ?? "finding";
      if (!declared) recorder.addLog("warn", `Flag "${name}" isn't declared in the pack's flags; counted as a finding.`);
      recorder.flags.push({ name, kind, detail: detail ?? null, declared });
      rt.onFlag({ name, kind, detail: detail ?? null });
    },

    metric(name, value, unit) {
      if (typeof value !== "number" || !Number.isFinite(value)) throw new StepError(`Metric "${name}" must be a finite number.`);
      recorder.metrics[name] = { value, unit: unit ?? null };
    },

    save(key, value) {
      rt.save(key, value);
    },

    load<T>(key: string) {
      return rt.load(key) as T | undefined;
    },

    info(key, value) {
      rt.info(key, value);
    },

    skip(reason): never {
      throw new SkipTest(reason);
    },

    async waitUntil(check, options = {}) {
      await enter();
      const timeout = options.timeout ?? 30_000;
      const interval = options.interval ?? 250;
      const stallMs = options.progress ? options.stallMs : undefined;
      // Time spent paused doesn't count: control.sleep stretches across a pause.
      let waited = 0;
      let last: unknown = options.progress?.();
      let still = 0;
      for (;;) {
        if (await Promise.resolve(check()).catch(() => false)) return "done";
        if (waited >= timeout) throw new StepError(`Waited ${Math.round(timeout / 1000)} s${options.what ? ` for ${options.what}` : ""} and it didn't happen.`);
        await control.sleep(interval);
        waited += interval;
        if (stallMs !== undefined && options.progress) {
          const now = options.progress();
          if (Object.is(now, last) || JSON.stringify(now) === JSON.stringify(last)) still += interval;
          else {
            still = 0;
            last = now;
          }
          if (still >= stallMs) {
            recorder.addLog("warn", `No progress for ${Math.round(stallMs / 1000)} s${options.what ? ` while waiting for ${options.what}` : ""}; stopped waiting.`);
            return "stalled";
          }
        }
      }
    },
  };

  if (extend) {
    for (const [k, v] of Object.entries(extend(h))) {
      if (k in h) throw new StepError(`The pack's helper "${k}" would replace a built-in helper.`);
      Object.defineProperty(h, k, { value: v, enumerable: true });
    }
  }
  return h;
}
