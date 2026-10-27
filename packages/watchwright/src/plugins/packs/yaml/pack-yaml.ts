import path from "node:path";
import type { BrowserContextOptions } from "playwright";
import type { Collector, PackOptions } from "../api.js";
import { consoleErrors, failedRequests, responses } from "../../testing/collectors.js";
import { checkDocument, type Parsed } from "./parse.js";
import { runSteps } from "./run.js";
import type { Step } from "./steps.js";
import { PACK_SHAPE, type PackYaml } from "./pack-shape.js";

// `pack.yaml`: a pack without code. It holds the pack options that are plain data, the built-in
// collectors by name, and steps for setup and around each attempt. Hooks, custom collectors,
// helpers and an idle check need a code pack file.

export function readPackYaml(text: string, file: string): Parsed<PackOptions | undefined> {
  const { value, problems } = checkDocument<PackYaml>(text, PACK_SHAPE, "pack");
  if (!value || problems.length > 0) return { value: undefined, problems };
  return { value: toOptions(value, file), problems };
}

function collectorsOf(list: PackYaml["collectors"]): Collector[] {
  const out: Collector[] = [];
  for (const c of list ?? []) {
    if (typeof c === "string") {
      if (c === "consoleErrors") out.push(consoleErrors());
      else if (c === "failedRequests") out.push(failedRequests());
      else out.push(responses());
      continue;
    }
    if (c.consoleErrors) out.push(consoleErrors(c.consoleErrors));
    if (c.failedRequests) out.push(failedRequests(c.failedRequests));
    if (c.responses) out.push(responses(c.responses));
  }
  return out;
}

function toOptions(y: PackYaml, file: string): PackOptions {
  const dir = path.dirname(file);
  const context = y.browser?.context ? { ...y.browser.context } : undefined;
  if (context && typeof context.storageState === "string") context.storageState = path.resolve(dir, context.storageState);
  const browser: NonNullable<PackOptions["browser"]> = {};
  if (y.browser?.name) browser.name = y.browser.name;
  if (y.browser?.viewport) browser.viewport = y.browser.viewport;
  if (y.browser?.headless !== undefined) browser.headless = y.browser.headless;
  if (context) browser.context = context as BrowserContextOptions;
  const options: PackOptions = { name: y.name, site: y.site };
  if (y.description) options.description = y.description;
  if (Object.keys(browser).length) options.browser = browser;
  if (y.params) options.params = y.params;
  if (y.flags) options.flags = y.flags;
  if (y.tests) options.tests = y.tests;
  if (y.run) options.run = y.run;
  if (y.rubric) options.rubric = y.rubric;
  if (y.collectors) options.collectors = collectorsOf(y.collectors);
  const setup = y.setup as Step[] | undefined;
  if (setup?.length) options.setup = ({ page, h, params, packDir }) => runSteps(setup, { page, h, params, packDir, file, attempt: 0, attempts: 0, last: false });
  const before = y.beforeEach as Step[] | undefined;
  if (before?.length) options.beforeAttempt = (c) => runSteps(before, { page: c.page, h: c.h, params: c.params, packDir: c.packDir, file, attempt: c.attempt, attempts: c.attempts, last: c.last });
  const after = y.afterEach as Step[] | undefined;
  if (after?.length) options.afterAttempt = (c) => runSteps(after, { page: c.page, h: c.h, params: c.params, packDir: c.packDir, file, attempt: c.attempt, attempts: c.attempts, last: c.last });
  return options;
}
