import type { Browser, BrowserContext, BrowserContextOptions, LaunchOptions, Page } from "playwright";
import type { expect as playwrightExpect } from "playwright/test";
import type { RubricCriterion, TestReview } from "./rubric.js";

// The pack API: what a test pack's files import from "watchwright". A pack is a folder with a
// `pack.ts` (or .js) that calls `pack({...})`, and test files that call `test(id, meta, body)`.
// See docs/plan.md, section 5.

export type BrowserName = "chromium" | "firefox" | "webkit";
export type ParamValue = string | number | boolean;
export type ParamValues = Record<string, ParamValue>;

export interface ParamDef {
  /** Default "string", or the type of `default` / the first choice. */
  type?: "string" | "number" | "boolean";
  choices?: readonly (string | number)[];
  default?: ParamValue;
  description?: string;
}

/**
 * What a flag means for the attempt that raises it. `robot`: the harness or the test went wrong,
 * the attempt is broken (and "redo broken" picks it up). `finding`: the site did something wrong,
 * the attempt failed. `info`: worth noting, changes nothing.
 */
export type FlagKind = "robot" | "finding" | "info";

/** Something a collector saw, stored with the attempt. */
export type CollectorRecord = Record<string, unknown>;

export interface Collector {
  /** File name for the collected records: `collectors/<name>.json`. */
  name: string;
  /** Called once per run with the browser context. Listen to its events and call `record`. */
  attach(context: BrowserContext, record: (entry: CollectorRecord) => void): void | Promise<void>;
}

/** A selector string (Playwright syntax) or a locator. */
export type Target = string | ReturnType<Page["locator"]>;

export interface ClickOptions {
  /** How to tell the click worked: an element that must appear, or a check that must turn true. */
  done?: Target | (() => boolean | Promise<boolean>);
  timeout?: number;
}

export interface ShotOptions {
  fullPage?: boolean;
  /** Capture only this element. */
  target?: Target;
}

/**
 * The helper every test gets as `h`. Each call is a pause point: a pause request takes effect at
 * the next helper call. Packs add their own helpers with `helpers` and declaration merging:
 * `declare module "watchwright" { interface Helpers { panel(): Promise<void> } }`.
 */
export interface Helpers {
  /** The page the test runs on. */
  readonly page: Page;
  readonly context: BrowserContext;
  readonly baseURL: string | undefined;
  /** Opens a URL; relative URLs resolve against the pack's `site.baseURL`. */
  goto(url: string, options?: { waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit" }): Promise<void>;
  click(target: Target, options?: ClickOptions): Promise<void>;
  fill(target: Target, value: string): Promise<void>;
  /** `press("Enter")` on the page, or `press(target, "Enter")` on an element. */
  press(targetOrKey: Target, key?: string): Promise<void>;
  /** True when the target is visible, waiting up to `timeout` ms (default 0: check once). */
  has(target: Target, timeout?: number): Promise<boolean>;
  /** Runs `fn` as a named step: shown live, logged, and a pause point. */
  step<T>(title: string, fn: () => Promise<T>): Promise<T>;
  /** Waits until the network is quiet and the pack's `idle` check (if any) says the app is idle. */
  idle(options?: { timeout?: number; quietMs?: number }): Promise<void>;
  /** Waits `ms` milliseconds; time spent paused doesn't count. */
  wait(ms: number): Promise<void>;
  /** Saves a screenshot as an artifact. */
  shot(name: string, options?: ShotOptions): Promise<void>;
  /** Scrolls the page (or an element) top to bottom and saves one screenshot per screen. */
  scrollShots(name: string, options?: { target?: Target; max?: number }): Promise<number>;
  /** Saves text as an artifact: an element's inner text, or the given string. */
  keepText(name: string, from: Target | { text: string }): Promise<string>;
  log(message: string): void;
  /** A note for people reviewing the result. */
  note(message: string): void;
  /** Raises a flag the pack declared in `flags`. */
  flag(name: string, detail?: string): void;
  metric(name: string, value: number, unit?: string): void;
  /** Keeps a value for later tests (see `needs`). Kept from a test's last attempt only. */
  save(key: string, value: unknown): void;
  /** A value an earlier test saved, or undefined. */
  load<T = unknown>(key: string): T | undefined;
}

export interface SetupContext {
  page: Page;
  context: BrowserContext;
  browser: Browser;
  h: Helpers;
  params: ParamValues;
}

export interface PackRunOptions {
  /** Pause the run when an attempt ends broken, waiting for Retry or Skip (default true). */
  pauseOnBroken?: boolean;
  /** Minutes a broken pause waits for an answer before it skips (default 20). */
  pauseLimitMinutes?: number;
  /** Time limit per attempt in ms, unless the test sets its own (default 30 minutes). */
  testTimeout?: number;
  /** Which attempts keep a Playwright trace (default "problems": broken and failed). */
  trace?: "problems" | "always" | "never";
  /** Record a video per attempt (default true; needs Playwright's ffmpeg). */
  video?: boolean;
  /** Draw click points and action titles into the live view and video (default true). */
  showActions?: boolean;
  /** Show each `h.step` title as a chapter card in the live view and video (default false). */
  chapters?: boolean;
  /** Live view and video size (default: the viewport). */
  screencastSize?: { width: number; height: number };
  /** JPEG quality of live frames, 1 to 100 (default 70). */
  frameQuality?: number;
}

export interface PackOptions {
  name: string;
  description?: string;
  /** Runs of packs with the same site key wait for each other. */
  site: { key: string; baseURL?: string };
  browser?: {
    name?: BrowserName;
    viewport?: { width: number; height: number };
    /** Default true while the live view is the way to watch. */
    headless?: boolean;
    launch?: LaunchOptions;
    context?: BrowserContextOptions;
  };
  params?: Record<string, ParamDef>;
  flags?: Record<string, FlagKind>;
  /** Globs of test files, relative to the pack file (default "tests/**\/*.{ts,mts,js,mjs}"). */
  tests?: string | readonly string[];
  /** Runs once per run, before the first test. */
  setup?: (ctx: SetupContext) => void | Promise<void>;
  collectors?: readonly Collector[];
  /** Extra helpers merged into `h`. */
  helpers?: (h: Helpers) => Record<string, unknown>;
  /** The app's own busy check for `h.idle()`: resolve true when the app is idle. */
  idle?: (page: Page) => boolean | Promise<boolean>;
  run?: PackRunOptions;
  /** What reviewers score each attempt on (default: one 1-to-5 "overall"). */
  rubric?: readonly RubricCriterion[];
}

export type RunsSpec = number | ((params: ParamValues) => number) | ({ by: string; default?: number } & Record<string, number | string | undefined>);

export interface TestMeta {
  title?: string;
  section?: string;
  tags?: readonly string[];
  /** How many attempts: a number, a function of the params, or `{ by: "model", q9: 3, default: 1 }`. */
  runs?: RunsSpec;
  /** Tests whose saved state this test uses. Choosing this test pulls them in, and runs them first. */
  needs?: readonly string[];
  /** The parent test whose body calls `child(id)` for this one. */
  inside?: string;
  /** Time limit per attempt in ms. */
  timeout?: number;
  /** Criteria this test adds to the pack's rubric, or drops from it. */
  review?: TestReview;
}

export type Outcome = "passed" | "failed" | "broken" | "skipped" | "stopped";

export interface TestContext {
  page: Page;
  h: Helpers;
  expect: typeof playwrightExpect;
  params: ParamValues;
  /** 1-based attempt number. */
  attempt: number;
  /** How many attempts this test gets in this run. */
  attempts: number;
  /** True on the test's final attempt. */
  last: boolean;
  /** Runs a child test (one that declares `inside: <this test>`) here, as its own attempt. */
  child(id: string): Promise<Outcome>;
}

export type TestBody = (ctx: TestContext) => void | Promise<void>;

export interface TestDefinition {
  id: string;
  meta: TestMeta;
  body: TestBody;
  /** The file that declared it, relative to the pack folder. */
  file: string;
}

export interface PackDefinition {
  options: PackOptions;
}

// While a pack build is being imported, its `pack()` and `test()` calls land in this collector.
// Imports are serialised by the loader, so there is never more than one.
interface Collecting {
  pack: PackOptions | null;
  tests: TestDefinition[];
  file: string;
}
let collecting: Collecting | null = null;

export function beginCollecting(): Collecting {
  collecting = { pack: null, tests: [], file: "" };
  return collecting;
}

export function endCollecting(): void {
  collecting = null;
}

/** Marks which source file the following `test()` calls come from (inserted by the loader). */
export function __fileMarker(file: string): void {
  if (collecting) collecting.file = file;
}

const TEST_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** Declares the pack. Call once, in the pack file, and export the result as default. */
export function pack(options: PackOptions): PackDefinition {
  if (collecting) {
    if (collecting.pack) throw new Error("pack() was called twice. A pack has one pack file.");
    collecting.pack = options;
  }
  return { options };
}

/** Declares a test. */
export function test(id: string, metaOrBody: TestMeta | TestBody, maybeBody?: TestBody): void {
  const meta = typeof metaOrBody === "function" ? {} : metaOrBody;
  const body = typeof metaOrBody === "function" ? metaOrBody : maybeBody;
  if (!TEST_ID.test(id)) throw new Error(`Test id "${id}" must be letters, digits, dots, dashes or underscores (up to 64).`);
  if (typeof body !== "function") throw new Error(`Test "${id}" has no body function.`);
  if (!collecting) return; // imported outside a pack load (an editor's type check): nothing to do
  if (collecting.tests.some((t) => t.id === id)) throw new Error(`Two tests have the id "${id}".`);
  collecting.tests.push({ id, meta, body, file: collecting.file });
}

/** Raised by helpers (and tests) when the harness can't do what it was asked: the attempt is broken, not failed. */
export class StepError extends Error {
  override name = "StepError";
}
