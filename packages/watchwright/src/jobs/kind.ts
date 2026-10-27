import type { Page } from "playwright";
import type { Helpers, Outcome, ParamValues } from "../plugins/packs/api.js";
import type { LoadedPack } from "../plugins/packs/loader.js";
import type { BrowserSession } from "../session/session.js";
import type { RunControl } from "./control.js";
import type { AttemptRecorder } from "./recorder.js";

// A job kind says what runs inside an attempt. The job runner owns everything around it (queue,
// site locks, browser session, pause and stop, hot reload, artifacts, events). Testing is the
// first kind; later kinds (scrape, crawl) implement the same interface (docs/plan.md, section 3).

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
}

/** What the runner gives a kind for one attempt. */
export interface AttemptEnv {
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
  /** Builds the `h` helper for this attempt. */
  helpers(): Helpers;
  /** Runs a child item inside this attempt, as its own attempt record. */
  runChild(itemId: string): Promise<Outcome>;
}

export interface SetupEnv {
  pack: LoadedPack;
  params: ParamValues;
  page: Page;
  session: BrowserSession;
  helpers(): Helpers;
}

export interface JobKind {
  name: string;
  plan(pack: LoadedPack, params: ParamValues, chosen: readonly string[]): KindPlan;
  /** Title and time limit (ms, null for the pack default) of an item. */
  describe(pack: LoadedPack, itemId: string): { title: string; timeout: number | null };
  /** Once per run (re)start, before the first attempt. */
  setup(env: SetupEnv): Promise<void>;
  /** Runs one attempt's body. Throws when it went wrong; the runner classifies. */
  execute(env: AttemptEnv): Promise<void>;
}
