import type { JobKind } from "../../jobs/kind.js";
import type { Helpers } from "../packs/api.js";
import type { LoadedPack } from "../packs/loader.js";
import { classify } from "../testing/outcome.js";
import { testKind } from "../testing/kind.js";

// The `task` job kind: one of a pack's `tasks`, run on its own (from the pack page, the CLI, an
// agent or a schedule). It doesn't run the pack's setup or teardown, and it may start while the
// site's run is paused (docs/research/run-lifecycle-tasks.md).

function taskOf(pack: LoadedPack, name: string) {
  const t = pack.options.tasks?.[name];
  if (!t) throw new Error(`The pack has no task "${name}". Its tasks: ${Object.keys(pack.options.tasks ?? {}).join(", ") || "none"}.`);
  return t;
}

export const taskKind: JobKind<Helpers> = {
  name: "task",
  labels: { passed: "done" },
  whilePaused: true,
  upkeep: true,

  helpers: (rt, pack) => testKind.helpers(rt, pack),
  classify,

  plan(pack, _params, chosen) {
    if (chosen.length !== 1) throw new Error(`Name one task to run (tests: ["<task>"]). This pack's tasks: ${Object.keys(pack.options.tasks ?? {}).join(", ") || "none"}.`);
    const name = chosen[0]!;
    taskOf(pack, name);
    return { items: [{ itemId: name, number: 1, of: 1 }], needs: new Map(), children: new Map() };
  },

  describe(pack, itemId) {
    const t = pack.options.tasks?.[itemId];
    return { title: t?.title ?? itemId, timeout: t?.timeout ?? null };
  },

  runLabel(pack, items) {
    return `Task: ${items.map((name) => pack.options.tasks?.[name]?.title ?? name).join(", ")}`;
  },

  touchesSite(pack, items) {
    return items.some((name) => pack.options.tasks?.[name]?.readOnly !== true);
  },

  // A task brings its own steps: the pack's setup (warm-ups, test data) isn't for it.
  async setup() {},

  async execute(env) {
    const t = taskOf(env.pack, env.itemId);
    await t.run({
      page: env.page,
      context: env.session.context,
      browser: env.session.browser,
      h: env.helpers(),
      params: env.params,
      packDir: env.pack.dir,
      state: env.state,
      run: env.packRun(),
      task: env.itemId,
    });
  },
};
