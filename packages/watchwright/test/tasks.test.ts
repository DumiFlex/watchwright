import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { RunDetail } from "../src/plugins/runs/engine.js";
import { cleanTempDirs, startSite, tempDir, writeFiles } from "./helpers/fixtures.js";
import { engineOf, hasChromium, requireBrowsers, startHarness, type Harness } from "./helpers/harness.js";

// Setup, teardown, afterTask, pack state and tasks (docs/research/run-lifecycle-tasks.md): real
// runs in Chromium against a tiny local site. The pack's hooks write what they saw into its
// state, which the tests read back through GET /packs/:id/state.

const run = hasChromium || requireBrowsers ? describe : describe.skip;

let site: { url: string; close(): Promise<void> };
const harnesses: Harness[] = [];

beforeAll(async () => {
  site = await startSite();
});
afterAll(async () => {
  await site.close();
});
afterEach(async () => {
  for (const h of harnesses.splice(0)) await h.close();
  cleanTempDirs();
});

// A pack whose hooks keep a log in its state, the way a pack keeps the name of a backup.
function packFile(extra = ""): string {
  return `
import { pack } from "watchwright";
const note = (state, line) => state.set("log", [...(state.get("log") ?? []), line]);
export default pack({
  name: "Lifecycle",
  site: { key: "life-${Math.random().toString(36).slice(2, 8)}", baseURL: ${JSON.stringify(site.url)} },
  browser: { name: "chromium", viewport: { width: 800, height: 600 } },
  run: { video: "never", trace: "never" },
  async setup({ start, state, run }) {
    note(state, "setup:" + start);
    if (start === "new") state.set("original", "backup-of-" + run.id);
  },
  async teardown({ h, state, status }) {
    await h.goto("/");
    note(state, "teardown:" + status);
  },
  async afterTask({ state, tasks }) {
    if (state.get("failAfterTask")) throw new Error("the data wouldn't come back");
    note(state, "afterTask:" + tasks.join("+"));
  },
  tasks: {
    restore: {
      title: "Restore the data",
      description: "Puts the original data back.",
      async run({ h, state, run, task }) {
        await h.goto("/");
        note(state, "task:" + task + ":" + (run ? run.status : "none"));
        await h.wait(Number(state.get("taskWait") ?? 0));
      },
    },
    look: { title: "Look around", readOnly: true, run: ({ state, run }) => note(state, "look:" + (run ? run.status : "none")) },
  },
  ${extra}
});`;
}

async function setup(tests: Record<string, string>, extra = "") {
  const packDir = tempDir("ww-life-");
  writeFiles(packDir, { "pack.ts": packFile(extra), ...tests });
  const h = await startHarness(tempDir("ww-data-"));
  harnesses.push(h);
  const added = await h.api<{ id: string; error: string | null; problems: string[]; tasks: unknown[]; hooks: unknown }>("POST", "/packs", { path: packDir });
  expect(added.status).toBe(201);
  expect(added.data.error).toBeNull();
  return { h, packId: added.data.id, pack: added.data };
}

async function start(h: Harness, body: Record<string, unknown>): Promise<string> {
  const res = await h.api<{ id: string }>("POST", "/runs", body);
  expect(res.error).toBeUndefined();
  return res.data.id;
}

async function finished(h: Harness, runId: string): Promise<RunDetail> {
  await h.waitFor((e) => e.runId === runId && (e.type === "run.finished" || e.type === "run.failed_to_start" || e.type === "run.interrupted"), 45_000);
  await engineOf(h).settled(runId);
  return (await h.api<RunDetail>("GET", `/runs/${runId}`)).data;
}

async function stateOf(h: Harness, packId: string): Promise<Record<string, unknown>> {
  const res = await h.api<{ key: string; value: unknown }[]>("GET", `/packs/${packId}/state`);
  return Object.fromEntries(res.data.map((e) => [e.key, e.value]));
}

async function setState(h: Harness, packId: string, key: string, value: unknown): Promise<void> {
  // Straight into the store the hooks use.
  const { PACK_STATE } = await import("../src/plugins/packs/state.js");
  h.app.watchwright.services.get(PACK_STATE).set(packId, key, value);
}

const SLOW = `
import { test } from "watchwright";
test("S1", async ({ h }) => { for (let i = 0; i < 20; i++) await h.wait(100); });
test("S2", async ({ h }) => { await h.wait(50); });`;

run("setup, teardown and tasks", { timeout: 60_000 }, () => {
  it("lists tasks and hooks, runs setup as new and teardown when the run finishes", async () => {
    const { h, packId, pack } = await setup({ "tests/a.ts": `import { test } from "watchwright"; test("A1", async ({ h }) => { await h.goto("/"); });` });
    expect(pack.tasks).toEqual([
      { id: "restore", title: "Restore the data", description: "Puts the original data back.", readOnly: false },
      { id: "look", title: "Look around", description: null, readOnly: true },
    ]);
    expect(pack.hooks).toEqual({ setup: true, teardown: true, afterTask: true });
    const runId = await start(h, { packId });
    const detail = await finished(h, runId);
    expect(detail.status).toBe("finished");
    const state = await stateOf(h, packId);
    expect(state.log).toEqual(["setup:new", "teardown:finished"]);
    expect(state.original).toBe(`backup-of-${runId}`);

    // A person can delete a value; a missing one is a 404.
    expect((await h.api("DELETE", `/packs/${packId}/state/log`)).status).toBe(200);
    expect((await h.api("DELETE", `/packs/${packId}/state/log`)).status).toBe(404);
    expect((await stateOf(h, packId)).log).toBeUndefined();
  });

  it("runs a task on its own: a run of the task kind that sees no run mid-way", async () => {
    const { h, packId } = await setup({ "tests/a.ts": `import { test } from "watchwright"; test("A1", async () => {});` });
    const taskId = await start(h, { packId, kind: "task", tests: ["restore"] });
    const detail = await finished(h, taskId);
    expect(detail.status).toBe("finished");
    expect(detail.attempts.map((a) => [a.testId, a.status])).toEqual([["restore", "passed"]]);
    // A task doesn't run the pack's setup or teardown.
    expect((await stateOf(h, packId)).log).toEqual(["task:restore:none"]);

    const bad = await h.api<unknown>("POST", "/runs", { packId, kind: "task", tests: ["nope"] });
    expect(bad.status).toBe(400);
    expect(bad.error?.message).toContain('no task "nope"');
    expect((await h.api("POST", "/runs", { packId, kind: "task" })).status).toBe(400);
  });

  it("starts a task while the site's run is paused, holds the run, then gives it afterTask and redoes the cut-short attempt", async () => {
    const { h, packId } = await setup({ "tests/slow.ts": SLOW });
    await setState(h, packId, "taskWait", 1500);
    const runId = await start(h, { packId });
    await h.waitFor((e) => e.type === "attempt.started" && e.runId === runId);
    await h.api("POST", `/runs/${runId}/pause`);
    await h.waitFor((e) => e.type === "run.paused" && e.runId === runId);

    const taskId = await start(h, { packId, kind: "task", tests: ["restore"] });
    await h.waitFor((e) => e.type === "attempt.started" && e.runId === taskId);
    // While the task runs, the paused run can't go on.
    const refused = await h.api<unknown>("POST", `/runs/${runId}/resume`);
    expect(refused.status).toBe(409);
    expect(refused.error?.code).toBe("site_busy");
    expect(refused.error?.message).toContain("Restore the data");
    await finished(h, taskId);

    expect((await h.api("POST", `/runs/${runId}/resume`)).status).toBe(200);
    const detail = await finished(h, runId);
    expect(detail.status).toBe("finished");
    expect((await stateOf(h, packId)).log).toEqual(["setup:new", "task:restore:paused", "afterTask:Restore the data", "teardown:finished"]);
    // S1 was paused mid-way: it ends stopped and runs again.
    const history = (await h.api<{ history: { testId: string; try: number; status: string; current: boolean }[] }>("GET", `/runs/${runId}?history=true`)).data.history;
    expect(history.filter((a) => a.testId === "S1").map((a) => [a.try, a.status, a.current])).toEqual([
      [1, "stopped", false],
      [2, "passed", true],
    ]);
    expect(detail.attempts.map((a) => [a.testId, a.status])).toEqual([
      ["S1", "passed"],
      ["S2", "passed"],
    ]);
  });

  it("pauses the run again when afterTask fails", async () => {
    const { h, packId } = await setup({ "tests/slow.ts": SLOW });
    await setState(h, packId, "failAfterTask", true);
    const runId = await start(h, { packId });
    await h.waitFor((e) => e.type === "attempt.started" && e.runId === runId);
    await h.api("POST", `/runs/${runId}/pause`);
    const first = await h.waitFor((e) => e.type === "run.paused" && e.runId === runId);
    await finished(h, await start(h, { packId, kind: "task", tests: ["restore"] }));
    expect((await h.api("POST", `/runs/${runId}/resume`)).status).toBe(200);
    const again = await h.waitFor((e) => e.type === "run.paused" && e.runId === runId && e.seq > first.seq);
    expect(again.data.by).toBe("afterTask");
    const failed = await h.waitFor((e) => e.type === "run.log" && e.runId === runId && String(e.data.message).startsWith("afterTask failed"));
    expect(failed.data.message).toContain("the data wouldn't come back");
    expect((await h.api("POST", `/runs/${runId}/resume`)).status).toBe(200);
    expect((await finished(h, runId)).status).toBe("finished");
  });

  it("lets a read-only task leave a paused run where it was", async () => {
    const { h, packId } = await setup({ "tests/slow.ts": SLOW });
    const runId = await start(h, { packId });
    await h.waitFor((e) => e.type === "attempt.started" && e.runId === runId);
    await h.api("POST", `/runs/${runId}/pause`);
    await h.waitFor((e) => e.type === "run.paused" && e.runId === runId);
    await finished(h, await start(h, { packId, kind: "task", tests: ["look"] }));
    expect((await h.api("POST", `/runs/${runId}/resume`)).status).toBe(200);
    const detail = await finished(h, runId);
    expect((await stateOf(h, packId)).log).toEqual(["setup:new", "look:paused", "teardown:finished"]);
    const history = (await h.api<{ history: { testId: string; status: string }[] }>("GET", `/runs/${runId}?history=true`)).data.history;
    expect(history.filter((a) => a.testId === "S1").map((a) => a.status)).toEqual(["passed"]);
    expect(detail.status).toBe("finished");
  });

  it("queues a task behind a going run until it pauses", async () => {
    const { h, packId } = await setup({ "tests/slow.ts": SLOW });
    const runId = await start(h, { packId });
    await h.waitFor((e) => e.type === "attempt.started" && e.runId === runId);
    const taskId = await start(h, { packId, kind: "task", tests: ["look"] });
    await new Promise((r) => setTimeout(r, 400));
    expect((await h.api<RunDetail>("GET", `/runs/${taskId}`)).data.status).toBe("queued");
    await h.api("POST", `/runs/${runId}/pause`);
    await finished(h, taskId);
    expect((await stateOf(h, packId)).log).toContain("look:paused");
    await h.api("POST", `/runs/${runId}/stop`, { when: "now" });
    await finished(h, runId);
  });

  it("runs teardown after stop now in a fresh browser context, and resumes with setup told so", async () => {
    const { h, packId } = await setup({ "tests/slow.ts": SLOW });
    const runId = await start(h, { packId });
    await h.waitFor((e) => e.type === "attempt.started" && e.runId === runId);
    await h.api("POST", `/runs/${runId}/stop`, { when: "now" });
    expect((await finished(h, runId)).status).toBe("stopped");
    expect((await stateOf(h, packId)).log).toEqual(["setup:new", "teardown:stopped"]);

    // A stopped run is mid-way: a task sees it.
    await finished(h, await start(h, { packId, kind: "task", tests: ["look"] }));
    expect((await h.api("POST", `/runs/${runId}/resume`)).status).toBe(200);
    expect((await finished(h, runId)).status).toBe("finished");
    expect((await stateOf(h, packId)).log).toEqual(["setup:new", "teardown:stopped", "look:stopped", "setup:resume", "teardown:finished"]);
  });

  it("runs teardown when setup fails partway", async () => {
    const packDir = tempDir("ww-life-");
    writeFiles(packDir, {
      "pack.ts": `
import { pack } from "watchwright";
export default pack({
  name: "Half setup",
  site: { key: "half-${Math.random().toString(36).slice(2, 8)}", baseURL: ${JSON.stringify(site.url)} },
  run: { video: "never" },
  async setup({ state }) { state.set("saved", true); throw new Error("the import failed"); },
  async teardown({ state, status }) { state.set("teardown", status); },
});`,
      "tests/a.ts": `import { test } from "watchwright"; test("A1", async () => {});`,
    });
    const h2 = await startHarness(tempDir("ww-data-"));
    harnesses.push(h2);
    const added = await h2.api<{ id: string }>("POST", "/packs", { path: packDir });
    const runId = await start(h2, { packId: added.data.id });
    const detail = await finished(h2, runId);
    expect(detail.status).toBe("failed_to_start");
    expect(await stateOf(h2, added.data.id)).toEqual({ saved: true, teardown: "failed" });
  });
});

describe("pack tasks in the pack file", () => {
  it("refuses tasks that aren't well formed", async () => {
    const packDir = tempDir("ww-life-");
    writeFiles(packDir, {
      "pack.ts": `
import { pack } from "watchwright";
export default pack({
  name: "Bad tasks",
  site: { key: "bad-tasks" },
  teardown: "no",
  tasks: { "Bad Name": { run: () => {} }, nothing: {}, slow: { run: () => {}, timeout: -1 } },
});`,
    });
    const h = await startHarness(tempDir("ww-data-"));
    harnesses.push(h);
    const added = await h.api<{ status: string; error: string | null; problems: string[] }>("POST", "/packs", { path: packDir });
    expect(added.data.error).toMatch(/options aren't valid/);
    const problems = added.data.problems;
    expect(problems).toEqual(
      expect.arrayContaining([
        "`teardown` must be a function.",
        expect.stringContaining('Task "Bad Name": names are lowercase'),
        'Task "nothing" needs a `run` function.',
        expect.stringContaining('Task "slow": `timeout`'),
      ]),
    );
  });

  it("reads teardown, afterTask and tasks from pack.yaml", async () => {
    const packDir = tempDir("ww-life-");
    writeFiles(packDir, {
      "pack.yaml": `
name: YAML tasks
site: { key: yaml-tasks }
teardown:
  - log: done
afterTask:
  - log: back
tasks:
  restore:
    title: Restore
    readOnly: false
    steps:
      - log: restoring
`,
    });
    const h = await startHarness(tempDir("ww-data-"));
    harnesses.push(h);
    const added = await h.api<{ error: string | null; tasks: unknown[]; hooks: unknown }>("POST", "/packs", { path: packDir });
    expect(added.data.error).toBeNull();
    expect(added.data.tasks).toEqual([{ id: "restore", title: "Restore", description: null, readOnly: false }]);
    expect(added.data.hooks).toEqual({ setup: false, teardown: true, afterTask: true });
  });
});
