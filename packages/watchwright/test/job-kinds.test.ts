import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { JobKind } from "../src/jobs/kind.js";
import { JobKinds } from "../src/jobs/kinds.js";
import { definePlugin } from "../src/core/plugin.js";
import type { RunDetail } from "../src/plugins/runs/engine.js";
import { JOB_KINDS } from "../src/plugins/runs/plugin.js";
import { cleanTempDirs, startSite, tempDir, writeFiles } from "./helpers/fixtures.js";
import { hasChromium, requireBrowsers, startHarness, type Harness } from "./helpers/harness.js";

// Job kinds come from plugins: the testing plugin registers `test`, another plugin can add its own.

/** A kind that visits the pack's site once per item; item "bad" throws. Its helper object is its own. */
const echoKind: JobKind<{ say(text: string): void }> = {
  name: "echo",
  labels: { passed: "done" },
  helpers: (rt) => ({ say: (text) => rt.recorder.addLog("info", `echo: ${text}`) }),
  classify: ({ error, stopped }) =>
    stopped ? { status: "stopped", error: null } : error === undefined ? { status: "passed", error: null } : { status: "broken", error: { kind: "exception", message: String(error), stack: null } },
  plan: (_pack, _params, chosen) => {
    const ids = chosen.length > 0 ? chosen : ["one", "bad"];
    return { items: ids.map((itemId) => ({ itemId, number: 1, of: 1 })), needs: new Map(), children: new Map() };
  },
  describe: (_pack, itemId) => ({ title: `Echo ${itemId}`, timeout: null }),
  setup: async () => undefined,
  async execute(env) {
    await env.page.goto(env.pack.options.site.baseURL ?? "about:blank");
    env.helpers().say(env.itemId);
    if (env.itemId === "bad") throw new Error("bad item");
  },
};

const echoPlugin = definePlugin({
  name: "echo",
  setup({ services }) {
    services.get(JOB_KINDS).register(echoKind);
  },
});

/** A kind whose items find more items: "start" adds p1 and p2, p1 adds p3; "slow" adds one item, then waits (for a restart). */
const crawlKind: JobKind<null> = {
  name: "crawl",
  helpers: () => null,
  classify: ({ error, stopped }) => (stopped ? { status: "stopped", error: null } : error === undefined ? { status: "passed", error: null } : { status: "broken", error: { kind: "exception", message: String(error), stack: null } }),
  plan: (_pack, _params, chosen) => ({ items: (chosen.length > 0 ? chosen : ["start"]).map((itemId) => ({ itemId, number: 1, of: 1 })), needs: new Map(), children: new Map() }),
  describe: (_pack, itemId) => ({ title: `Page ${itemId}`, timeout: null }),
  setup: async () => undefined,
  async execute(env) {
    const found: Record<string, string[]> = { start: ["p1", "p2", "p1"], p1: ["p3", "start"], slow: ["after-slow"] };
    const results = (found[env.itemId] ?? []).map((id) => env.addItem(id));
    env.recorder.addLog("info", `added ${JSON.stringify(results)}`);
    if (env.itemId === "slow") await env.page.waitForTimeout(20_000);
  },
};

const crawlPlugin = definePlugin({
  name: "crawl",
  setup({ services }) {
    services.get(JOB_KINDS).register(crawlKind);
  },
});

const harnesses: Harness[] = [];
afterEach(async () => {
  for (const h of harnesses.splice(0)) await h.close();
  cleanTempDirs();
});

describe("JobKinds", () => {
  it("registers kinds by name and refuses bad or repeated names", () => {
    const kinds = new JobKinds();
    kinds.register(echoKind);
    expect(kinds.get("echo")).toBe(echoKind);
    expect(kinds.list().map((k) => k.name)).toEqual(["echo"]);
    expect(() => kinds.register(echoKind)).toThrow(/Two plugins/);
    expect(() => kinds.register({ ...echoKind, name: "Echo" })).toThrow(/lowercase/);
  });
});

describe("job kinds through the API", () => {
  it("lists the loaded kinds with their outcome words", async () => {
    const h = await startHarness(tempDir("ww-data-"), { plugins: [echoPlugin] });
    harnesses.push(h);
    const res = await h.api<{ name: string; labels: Record<string, string> }[]>("GET", "/kinds");
    expect(res.data).toEqual([
      { name: "test", labels: {} },
      { name: "echo", labels: { passed: "done" } },
    ]);
  });

  it("refuses a run of a kind that isn't loaded", async () => {
    const h = await startHarness(tempDir("ww-data-"));
    harnesses.push(h);
    const packDir = tempDir("ww-pack-");
    writeFiles(packDir, { "pack.ts": `import { pack } from "watchwright"; export default pack({ name: "P", site: { key: "p" }, tests: [] });` });
    const added = await h.api<{ id: string }>("POST", "/packs", { path: packDir });
    const res = await h.api("POST", "/runs", { packId: added.data.id, kind: "nope" });
    expect(res.status).toBe(400);
    expect(res.error?.code).toBe("bad_input");
    expect(res.error?.message).toMatch(/No job kind "nope".*test/);
  });
});

const engine = hasChromium || requireBrowsers ? describe : describe.skip;

engine("a job kind from another plugin", () => {
  let site: { url: string; close(): Promise<void> };
  beforeAll(async () => {
    site = await startSite();
  });
  afterAll(async () => {
    await site.close();
  });

  it("runs its items with its own helpers and outcome rules", async () => {
    const h = await startHarness(tempDir("ww-data-"), { plugins: [echoPlugin] });
    harnesses.push(h);
    const packDir = tempDir("ww-pack-");
    writeFiles(packDir, {
      "pack.ts": `import { pack } from "watchwright"; export default pack({ name: "Echo", site: { key: "echo-site", baseURL: ${JSON.stringify(site.url)} }, run: { video: false }, tests: [] });`,
    });
    const added = await h.api<{ id: string }>("POST", "/packs", { path: packDir });
    const started = await h.api<{ id: string; kind: string }>("POST", "/runs", { packId: added.data.id, kind: "echo", pauseOnBroken: false, video: false });
    expect(started.status).toBe(201);
    expect(started.data.kind).toBe("echo");
    const runId = started.data.id;
    await h.waitFor((e) => e.runId === runId && (e.type === "run.finished" || e.type === "run.failed_to_start"), 45_000);

    const detail = await h.api<RunDetail>("GET", `/runs/${runId}`);
    expect(detail.data.status).toBe("finished");
    const byItem = Object.fromEntries(detail.data.attempts.map((a) => [a.testId, a]));
    expect(byItem.one?.kind).toBe("echo");
    expect(byItem.one?.status).toBe("passed");
    expect(byItem.bad?.status).toBe("broken");
    expect(byItem.bad?.error?.message).toMatch(/bad item/);

    const doc = await h.api<{ log: { message: string }[] }>("GET", `/runs/${runId}/attempts/${byItem.one!.id}`);
    expect(doc.data.log.map((l) => l.message)).toContain("echo: one");
  });
});

engine("a run that grows", () => {
  let site: { url: string; close(): Promise<void> };
  beforeAll(async () => {
    site = await startSite();
  });
  afterAll(async () => {
    await site.close();
  });

  async function crawlPack(h: Harness): Promise<string> {
    const packDir = tempDir("ww-pack-");
    writeFiles(packDir, {
      "pack.ts": `import { pack } from "watchwright"; export default pack({ name: "Crawl", site: { key: "crawl-site", baseURL: ${JSON.stringify(site.url)} }, run: { video: false }, tests: [] });`,
    });
    return (await h.api<{ id: string }>("POST", "/packs", { path: packDir })).data.id;
  }

  it("runs the items a kind adds, once each, at the end of the queue", async () => {
    const h = await startHarness(tempDir("ww-data-"), { plugins: [crawlPlugin] });
    harnesses.push(h);
    const packId = await crawlPack(h);
    const runId = (await h.api<{ id: string }>("POST", "/runs", { packId, kind: "crawl", video: false })).data.id;
    await h.waitFor((e) => e.runId === runId && e.type === "run.finished", 45_000);

    const detail = (await h.api<RunDetail>("GET", `/runs/${runId}`)).data;
    expect(detail.attempts.map((a) => `${a.testId}:${a.status}`)).toEqual(["start:passed", "p1:passed", "p2:passed", "p3:passed"]);
    expect(detail.plan.map((p) => p.testId)).toEqual(["start", "p1", "p2", "p3"]);
    expect(detail.options.added).toEqual([
      { itemId: "p1", of: 1 },
      { itemId: "p2", of: 1 },
      { itemId: "p3", of: 1 },
    ]);
    const start = await h.api<{ log: { message: string }[] }>("GET", `/runs/${runId}/attempts/${detail.attempts[0]!.id}`);
    expect(start.data.log.map((l) => l.message)).toContain("added [true,true,false]");
    const announced = h.app.watchwright.events.after(0).filter((e) => e.runId === runId && e.type === "run.items-added");
    expect(announced.flatMap((e) => e.data.items as string[])).toEqual(["p1", "p2", "p3"]);
  });

  it("keeps added items when an interrupted run resumes", async () => {
    const dataDir = tempDir("ww-data-");
    const first = await startHarness(dataDir, { plugins: [crawlPlugin] });
    harnesses.push(first);
    const packId = await crawlPack(first);
    const runId = (await first.api<{ id: string }>("POST", "/runs", { packId, kind: "crawl", tests: ["slow"], video: false })).data.id;
    await first.waitFor((e) => e.runId === runId && e.type === "run.items-added", 30_000);
    await first.close(); // the server goes down while "slow" runs

    const second = await startHarness(dataDir, { plugins: [crawlPlugin] });
    harnesses.push(second);
    expect((await second.api<RunDetail>("GET", `/runs/${runId}`)).data.status).toBe("interrupted");
    const head = second.app.watchwright.events.head();
    expect((await second.api("POST", `/runs/${runId}/resume`)).status).toBe(200);
    // "slow" runs again (and waits); the item it added before the restart is still in the plan.
    await second.waitFor((e) => e.runId === runId && e.type === "run.planned", 30_000, head);
    const detail = (await second.api<RunDetail>("GET", `/runs/${runId}`)).data;
    expect(detail.plan.map((p) => p.testId)).toEqual(["slow", "after-slow"]);
    await second.api("POST", `/runs/${runId}/stop`, { when: "now" });
    await second.waitFor((e) => e.runId === runId && e.type === "run.finished", 30_000, head);
  });
});
