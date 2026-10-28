import type { Page } from "playwright";
import type { Outcome, ParamValues } from "../plugins/packs/api.js";
import type { LoadedPack } from "../plugins/packs/loader.js";
import type { BrowserSession } from "../session/session.js";
import type { RunControl } from "./control.js";
import type { AttemptRecorder, FlagRecord } from "./recorder.js";
import type { AttemptRuntime } from "./runtime.js";

// A job kind says what runs inside an attempt. The job runner owns everything around it (queue,
// site locks, browser session, pause and stop, hot reload, artifacts, events). Testing is the
// first kind; later kinds (scrape, crawl) implement the same interface (docs/plan.md, section 3).
// A plugin registers its kinds with the runs plugin's `JOB_KINDS` service.

export interface AttemptError {
  /** assertion: an expect failed. step: the harness couldn't do a step. skipped: the item skipped itself. timeout, exception, stopped. */
  kind: "assertion" | "step" | "timeout" | "exception" | "stopped" | "skipped";
  message: string;
  stack: string | null;
}

/** How an attempt's body ended, for `JobKind.classify`. */
export interface AttemptEnd {
  /** What the body threw; undefined when it returned. */
  error: unknown;
  flags: readonly FlagRecord[];
  /** The run was stopped ("now") or the server shut down during the attempt. */
  stopped: boolean;
}

export interface PlanItem {
  itemId: string;
  /** 1-based attempt number and how many attempts the item gets. */
  number: number;
  of: number;
}

export interface KindPlan {
  /** Top-level attempts in run order. */
  items: PlanItem[];
  /** Items each item needs to have run first (a need that broke skips the item). */
  needs: Map<string, string[]>;
  /** Items a parent item runs from inside its own attempt. */
  children: Map<string, string[]>;
  /** A child's own attempt count, when it caps the parent's (a parent attempt past it doesn't run the child). */
  childAttempts?: Map<string, number>;
}

/** What the runner gives a kind for one attempt. */
export interface AttemptEnv<H = unknown> {
  pack: LoadedPack;
  itemId: string;
  number: number;
  of: number;
  last: boolean;
  params: ParamValues;
  page: Page;
  session: BrowserSession;
  control: RunControl;
  recorder: AttemptRecorder;
  /** This kind's helper object for this attempt (what `JobKind.helpers` builds). */
  helpers(): H;
  /** Runs a child item inside this attempt, as its own attempt record. */
  runChild(itemId: string): Promise<Outcome>;
  /**
   * Adds an item to the run while it runs (a crawl that found a page), with `attempts` attempts
   * (default 1), at the end of the queue. False when the run already has the item, has gone
   * through its queue, or has reached its limit of added items. Added items survive a resume.
   */
  addItem(itemId: string, options?: { attempts?: number }): boolean;
}

export interface SetupEnv<H = unknown> {
  pack: LoadedPack;
  params: ParamValues;
  page: Page;
  session: BrowserSession;
  helpers(): H;
  /** Saves a fact about the run. */
  info(key: string, value: string | number | boolean): void;
}

/** Choices of a run that change its plan. */
export interface PlanOptions {
  /** Attempts for every item, instead of what the pack says. */
  attempts?: number | undefined;
}

export interface JobKind<H = unknown> {
  /** Lowercase letters, digits and dashes; stored on runs and attempts. */
  name: string;
  /**
   * Words for outcomes in this kind (an extraction calls `passed` "done"). The outcome stays the
   * value everywhere; the web app, CLI and agents show the word.
   */
  labels?: Partial<Record<Outcome, string>>;
  plan(pack: LoadedPack, params: ParamValues, chosen: readonly string[], options?: PlanOptions): KindPlan;
  /** Title and time limit (ms, null for the pack default) of an item. */
  describe(pack: LoadedPack, itemId: string): { title: string; timeout: number | null };
  /** Builds this kind's helper object (the `test` kind's `h`) from what the runner gives every attempt. */
  helpers(rt: AttemptRuntime, pack: LoadedPack): H;
  /** The outcome of an attempt from how its body ended. */
  classify(end: AttemptEnd): { status: Outcome; error: AttemptError | null };
  /** Once per run (re)start, before the first attempt. */
  setup(env: SetupEnv<H>): Promise<void>;
  /** Runs one attempt's body. Throws when it went wrong; the runner classifies. */
  execute(env: AttemptEnv<H>): Promise<void>;
  /** After an attempt that wasn't stopped, with its outcome. Errors are logged, not raised. */
  afterAttempt?(env: AttemptEnv<H>, outcome: Outcome): Promise<void>;
}
