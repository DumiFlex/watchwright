import { expect } from "playwright/test";
import type { JobKind } from "../../jobs/kind.js";
import { attemptsFor, planTests } from "../packs/order.js";

/** The `test` job kind: a pack's tests, their attempts, `needs` and `inside` children. */
export const testKind: JobKind = {
  name: "test",

  plan(pack, params, chosen, options) {
    const { order, children } = planTests(pack.tests, chosen);
    const byId = new Map(pack.tests.map((t) => [t.id, t]));
    const items = order.flatMap((id) => {
      const of = options?.attempts ?? attemptsFor(byId.get(id)!.meta.runs, params);
      return Array.from({ length: of }, (_, i) => ({ itemId: id, number: i + 1, of }));
    });
    const needs = new Map(pack.tests.map((t) => [t.id, [...(t.meta.needs ?? [])]]));
    return { items, needs, children };
  },

  describe(pack, itemId) {
    const t = pack.tests.find((x) => x.id === itemId);
    return { title: t?.meta.title ?? itemId, timeout: t?.meta.timeout ?? null };
  },

  async setup({ pack, params, page, session, helpers }) {
    const fn = pack.options.setup;
    if (fn) await fn({ page, context: session.context, browser: session.browser, h: helpers(), params });
  },

  async execute(env) {
    const t = env.pack.tests.find((x) => x.id === env.itemId);
    if (!t) throw new Error(`The pack no longer has a test "${env.itemId}" (was it renamed?).`);
    await t.body({
      page: env.page,
      h: env.helpers(),
      expect,
      params: env.params,
      attempt: env.number,
      attempts: env.of,
      last: env.last,
      child: (id) => env.runChild(id),
    });
  },
};
