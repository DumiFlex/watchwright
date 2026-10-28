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
