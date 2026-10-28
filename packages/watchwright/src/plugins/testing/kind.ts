import { expect } from "playwright/test";
import type { AttemptEnv, JobKind } from "../../jobs/kind.js";
import type { AttemptHookContext, Helpers, TestDefinition, TestMeta } from "../packs/api.js";
import { attemptsFor, planTests } from "../packs/order.js";
import { createHelpers } from "./helpers.js";
import { classify } from "./outcome.js";

/** The `test` job kind: a pack's tests, their attempts, `needs` and `inside` children. */
export const testKind: JobKind<Helpers> = {
  name: "test",

  helpers(rt, pack) {
    const o = pack.options;
    return createHelpers(
      { ...rt, baseURL: o.site.baseURL, flagKinds: { ...(o.flags ?? {}) }, idleCheck: o.idle, chapters: o.run?.chapters ?? false },
      o.helpers,
    );
  },

  classify,

  plan(pack, params, chosen, options) {
    const { order, children } = planTests(pack.tests, chosen);
    const byId = new Map(pack.tests.map((t) => [t.id, t]));
    // The run's "attempts per test" replaces the pack's count, but never brings back a test the
    // pack gave 0 attempts for these params (a subset, an optional section).
    const count = (runs: TestMeta["runs"]) => {
      const own = attemptsFor(runs, params);
      return own === 0 ? 0 : (options?.attempts ?? own);
    };
    const items = order.flatMap((id) => {
      const of = count(byId.get(id)!.meta.runs);
      return Array.from({ length: of }, (_, i) => ({ itemId: id, number: i + 1, of }));
    });
    const needs = new Map(pack.tests.map((t) => [t.id, [...(t.meta.needs ?? [])]]));
    const childAttempts = new Map<string, number>();
    for (const kids of children.values())
      for (const c of kids) {
        const runs = byId.get(c)!.meta.runs;
        if (runs !== undefined) childAttempts.set(c, count(runs));
      }
    return { items, needs, children, childAttempts };
  },

  describe(pack, itemId) {
    const t = pack.tests.find((x) => x.id === itemId);
    return { title: t?.meta.title ?? itemId, timeout: t?.meta.timeout ?? null };
  },

  async setup({ pack, params, page, session, helpers, info }) {
    const fn = pack.options.setup;
    if (fn) await fn({ page, context: session.context, browser: session.browser, h: helpers(), params, packDir: pack.dir, info });
  },

  async execute(env) {
    const t = env.pack.tests.find((x) => x.id === env.itemId);
    if (!t) throw new Error(`The pack no longer has a test "${env.itemId}" (was it renamed?).`);
    const before = env.pack.options.beforeAttempt;
    if (before) await before(hookContext(env, t));
    await t.body({
      page: env.page,
      h: env.helpers(),
      expect,
      params: env.params,
      attempt: env.number,
      attempts: env.of,
      last: env.last,
      packDir: env.pack.dir,
      child: (id) => env.runChild(id),
    });
  },

  async afterAttempt(env, outcome) {
    const after = env.pack.options.afterAttempt;
    const t = env.pack.tests.find((x) => x.id === env.itemId);
    if (after && t) await after({ ...hookContext(env, t), outcome });
  },
};

function hookContext(env: AttemptEnv<Helpers>, t: TestDefinition): AttemptHookContext {
  return {
    page: env.page,
    h: env.helpers(),
    params: env.params,
    packDir: env.pack.dir,
    test: { id: t.id, title: t.meta.title ?? t.id, section: t.meta.section ?? null, tags: [...(t.meta.tags ?? [])] },
    attempt: env.number,
    attempts: env.of,
    last: env.last,
  };
}
