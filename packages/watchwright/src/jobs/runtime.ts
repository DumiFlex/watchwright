import type { BrowserContext, Page } from "playwright";
import type { FlagKind } from "../plugins/packs/api.js";
import type { BrowserSession } from "../session/session.js";
import type { RunControl } from "./control.js";
import type { AttemptRecorder } from "./recorder.js";

// What the job runner gives every kind for one attempt (or a run's setup): the page and its
// session, pause control, the recorder, saved values and the events it reports. A kind turns this
// into its own helper object (`JobKind.helpers`); the `test` kind makes `h` from it.

export interface AttemptRuntime {
  page: Page;
  context: BrowserContext;
  control: RunControl;
  recorder: AttemptRecorder;
  session: BrowserSession;
  /** Keeps a value for later items of the run (`needs`). */
  save(key: string, value: unknown): void;
  load(key: string): unknown;
  /** Saves a fact about the run. */
  info(key: string, value: string | number | boolean): void;
  /** A secret's value by name (Settings > Secrets), or undefined. */
  secret(name: string): string | undefined;
  /** Saves the browser's cookies and local storage as the site's sign-in (Settings > Sign-ins); returns the site key. */
  saveSignIn(): Promise<string>;
  onStep(title: string | null): void;
  onFlag(flag: { name: string; kind: FlagKind; detail: string | null }): void;
}
