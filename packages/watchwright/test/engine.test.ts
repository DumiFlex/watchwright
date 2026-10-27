import { existsSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { decodeFrame } from "../src/plugins/live/hub.js";
import type { RunDetail } from "../src/plugins/runs/engine.js";
import type { ResultDocument } from "../src/plugins/runs/results.js";
import { cleanTempDirs, startSite, tempDir, writeFiles } from "./helpers/fixtures.js";
import { readZip } from "./helpers/zip.js";
import { engineOf, hasChromium, hasFirefox, requireBrowsers, startHarness, type Harness } from "./helpers/harness.js";

// Engine tests: real browsers against a tiny local site, through the HTTP API.

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

function packFiles(extra = "", browser = "chromium"): string {
  return `
import { pack, consoleErrors, failedRequests } from "watchwright";
export default pack({
  name: "Fixture",
  site: { key: "fixture-${Math.random().toString(36).slice(2, 8)}", baseURL: ${JSON.stringify(site.url)} },
  browser: { name: "${browser}", viewport: { width: 800, height: 600 } },
  flags: { "no-card": "robot", "slow": "finding", "fyi": "info" },
  params: { label: { default: "hello" } },
  collectors: [consoleErrors(), failedRequests()],
  ${extra}
});`;
}

async function setup(files: Record<string, string>, opts: { listen?: boolean; dataDir?: string } = {}) {
  const packDir = tempDir("ww-pack-");
  writeFiles(packDir, { "pack.ts": packFiles(), ...files });
  const h = await startHarness(opts.dataDir ?? tempDir("ww-data-"), opts);
  harnesses.push(h);
  const added = await h.api<{ id: string; status: string; problems: string[]; error: string | null }>("POST", "/packs", { path: packDir });
  expect(added.status).toBe(201);
  expect(added.data.error).toBeNull();
  return { h, packDir, packId: added.data.id };
}

async function startRun(h: Harness, body: Record<string, unknown>): Promise<string> {
  const res = await h.api<{ id: string }>("POST", "/runs", body);
  expect(res.error).toBeUndefined();
  expect(res.status).toBe(201);
  return res.data.id;
}

async function finished(h: Harness, runId: string): Promise<RunDetail> {
  await h.waitFor((e) => e.runId === runId && (e.type === "run.finished" || e.type === "run.failed_to_start" || e.type === "run.interrupted"), 45_000);
  await engineOf(h).settled(runId);
  return (await h.api<RunDetail>("GET", `/runs/${runId}`)).data;
}

const byTest = (d: RunDetail) => Object.fromEntries(d.attempts.map((a) => [`${a.testId}#${a.number}`, a.status]));

/** Rewrites a file with a later mtime so the change is seen even within the same millisecond. */
function rewrite(file: string, content: string) {
  writeFileSync(file, content);
  const later = new Date(Date.now() + 2000);
  utimesSync(file, later, later);
}

run("engine", { timeout: 60_000 }, () => {
  it("skips and moves tests in the queue while the run goes", async () => {
    const { h, packId } = await setup({
      "tests/q.ts": `
import { test } from "watchwright";
test("Q1", { title: "Slow first" }, async ({ h }) => { await h.goto("/"); await h.wait(1500); });
test("Q2", { title: "Second" }, async ({ h }) => { await h.goto("/"); });
test("Q3", { title: "Third" }, async ({ h }) => { await h.goto("/"); });
test("Q4", { title: "Needs Q2", needs: ["Q2"] }, async ({ h }) => { await h.goto("/"); });`,
    });
    const runId = await startRun(h, { packId });
    await h.waitFor((e) => e.runId === runId && e.type === "attempt.started");
    const moved = await h.api<RunDetail>("POST", `/runs/${runId}/queue/move`, { testId: "Q3", direction: "up" });
    expect(moved.status).toBe(200);
    expect(moved.data.plan.map((p) => p.testId)).toEqual(["Q1", "Q3", "Q2", "Q4"]);
    const blocked = await h.api("POST", `/runs/${runId}/queue/move`, { testId: "Q4", direction: "up" });
    expect(blocked.status).toBe(400);
    expect(blocked.error?.message).toMatch(/Q4 needs Q2/);
    const started = await h.api("POST", `/runs/${runId}/queue/skip`, { testId: "Q1" });
    expect(started.status).toBe(400);
    // The first frame arrives once the page paints.
    type Marked = { attemptId: string; artifact: { kind: string; name: string; url: string } };
    let mark = await h.api<Marked>("POST", `/runs/${runId}/mark`, { note: "that looked wrong" });
    for (let i = 0; i < 20 && mark.error?.code === "no_frame"; i++) {
      await new Promise((r) => setTimeout(r, 50));
      mark = await h.api<Marked>("POST", `/runs/${runId}/mark`, { note: "that looked wrong" });
    }
    expect(mark.error).toBeUndefined();
    expect(mark.status).toBe(201);
    expect(mark.data.artifact).toMatchObject({ kind: "mark", name: "that looked wrong" });
    const skipped = await h.api<RunDetail>("POST", `/runs/${runId}/queue/skip`, { testId: "Q2" });
    expect(skipped.data.plan.find((p) => p.testId === "Q2")?.skip).toBe(true);

    const detail = await finished(h, runId);
    expect(byTest(detail)).toEqual({ "Q1#1": "passed", "Q3#1": "passed", "Q2#1": "skipped", "Q4#1": "skipped" });
    const order = detail.attempts.slice().sort((a, b) => a.startedAt.localeCompare(b.startedAt)).map((a) => a.testId);
    expect(order.indexOf("Q3")).toBeLessThan(order.indexOf("Q2"));
    expect(detail.options.queue).toEqual({ order: ["Q1", "Q3", "Q2", "Q4"], skip: ["Q2#1"] });
    const q1 = (await h.api<ResultDocument>("GET", `/runs/${runId}/attempts/${mark.data.attemptId}`)).data;
    expect(q1.test.id).toBe("Q1");
    expect(q1.notes).toEqual([expect.stringMatching(/^Mark \d\d-mark\.jpg: that looked wrong$/)]);
    const jpeg = await h.app.inject({ url: mark.data.artifact.url, headers: { host: h.host } });
    expect(jpeg.headers["content-type"]).toBe("image/jpeg");
    expect((await h.api("POST", `/runs/${runId}/mark`, {})).status).toBe(409);
  });

  it("adds tests to a run that is going, with what they need", async () => {
    const { h, packId, packDir } = await setup({
      "tests/q.ts": `
import { test } from "watchwright";
test("A1", { title: "Slow first" }, async ({ h }) => { await h.goto("/"); await h.wait(1500); });
test("A2", { title: "Second" }, async ({ h }) => { await h.goto("/"); });
test("A3", { title: "Needs A2", needs: ["A2"] }, async ({ h }) => { await h.goto("/"); });`,
    });
    const runId = await startRun(h, { packId, tests: ["A1"] });
    await h.waitFor((e) => e.runId === runId && e.type === "attempt.started");
    // A test written after the run started can be added too.
    writeFiles(packDir, { "tests/late.ts": `import { test } from "watchwright";\ntest("L1", { title: "Late" }, async ({ h }) => { await h.goto("/"); });` });
    const added = await h.api<RunDetail>("POST", `/runs/${runId}/queue/add`, { tests: ["A3", "L1"] });
    expect(added.error).toBeUndefined();
    // Added tests go after what was there, in the pack's planned order.
    const planned = added.data.plan.map((p) => p.testId);
    expect(planned[0]).toBe("A1");
    expect(planned.slice(1).sort()).toEqual(["A2", "A3", "L1"]);
    expect(planned.indexOf("A2")).toBeLessThan(planned.indexOf("A3"));
    expect(added.data.tests).toEqual(["A1", "A3", "L1"]);
    // The rewind buffer holds what the live view showed; a mark can take a frame from it.
    type Rewind = { windowMs: number; frames: { pageId: string; timestamp: number; url: string }[] };
    let rewind = await h.api<Rewind>("GET", `/live/${runId}/rewind`);
    for (let i = 0; i < 20 && rewind.data.frames.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 50));
      rewind = await h.api<Rewind>("GET", `/live/${runId}/rewind`);
    }
    expect(rewind.data.windowMs).toBe(30_000);
    const first = rewind.data.frames[0]!;
    const jpeg = await h.app.inject({ url: first.url, headers: { host: h.host } });
    expect(jpeg.statusCode).toBe(200);
    expect(jpeg.headers["content-type"]).toBe("image/jpeg");
    expect((await h.app.inject({ url: `/api/v1/live/${runId}/rewind/${first.pageId}/1.jpg`, headers: { host: h.host } })).statusCode).toBe(404);
    const back = await h.api<{ artifact: { kind: string } }>("POST", `/runs/${runId}/mark`, { note: "earlier", pageId: first.pageId, at: first.timestamp });
    expect(back.status).toBe(201);
    expect((await h.api("POST", `/runs/${runId}/mark`, { at: 1 })).error?.code).toBe("no_frame");
    const again = await h.api("POST", `/runs/${runId}/queue/add`, { tests: ["A2"] });
    expect(again.status).toBe(400);
    expect(again.error?.message).toMatch(/A2 is already in the run/);
    expect((await h.api("POST", `/runs/${runId}/queue/add`, { tests: ["Nope"] })).error?.message).toMatch(/no test "Nope"/);

    const detail = await finished(h, runId);
    expect(byTest(detail)).toEqual({ "A1#1": "passed", "A2#1": "passed", "A3#1": "passed", "L1#1": "passed" });
    expect(detail.options.queue?.order).toEqual(planned);
    expect((await h.api("POST", `/runs/${runId}/queue/add`, { tests: ["A2"] })).status).toBe(409);
  });

  it("takes attempts, trace and video from the run's options over the pack's", async () => {
    const { h, packId } = await setup({
      "tests/one.ts": `
import { test } from "watchwright";
test("O1", { title: "Once by the pack" }, async ({ h }) => { await h.goto("/"); });`,
    });
    const runId = await startRun(h, { packId, attempts: 2, trace: "always", video: false });
    const detail = await finished(h, runId);
    expect(byTest(detail)).toEqual({ "O1#1": "passed", "O1#2": "passed" });
    expect(detail.options).toMatchObject({ attempts: 2, trace: "always", video: false });
    for (const a of detail.attempts) {
      const doc = (await h.api<ResultDocument>("GET", `/runs/${runId}/attempts/${a.id}`)).data;
      expect(doc.artifacts.some((x) => x.kind === "trace")).toBe(true);
      expect(doc.artifacts.some((x) => x.kind === "video")).toBe(false);
    }
  });

  it("runs a pack and keeps every result", async () => {
    const { h, packId } = await setup({
      "tests/home.ts": `
import { test } from "watchwright";
test("H1", { title: "Home loads", section: "H", runs: 2 }, async ({ h, expect, attempt, params }) => {
  await h.goto("/");
  await expect(h.page.getByRole("heading", { level: 1 })).toHaveText("Fixture home");
  await h.shot("home");
  await h.scrollShots("page", { max: 2 });
  await h.keepText("heading", "h1");
  h.metric("attempt", attempt, "n");
  h.note("label is " + params.label);
  h.save("greeting", "hi from H1 attempt " + attempt);
});
test("H2", { title: "Counter", needs: ["H1"] }, async ({ h, expect }) => {
  await h.goto("/");
  await h.step("press the button", async () => {
    await h.click("#inc", { done: async () => (await h.page.textContent("#n")) === "1" });
  });
  await expect(h.page.locator("#n")).toHaveText("1");
  await h.keepText("saved", { text: String(h.load("greeting")) });
  h.flag("fyi", "just so you know");
});`,
    });
    const runId = await startRun(h, { packId, params: { label: "custom" } });
    const detail = await finished(h, runId);
    expect(detail.status).toBe("finished");
    expect(byTest(detail)).toEqual({ "H1#1": "passed", "H1#2": "passed", "H2#1": "passed" });
    expect(detail.plan.map((p) => `${p.testId}#${p.number}/${p.of}:${p.status}`)).toEqual(["H1#1/2:passed", "H1#2/2:passed", "H2#1/1:passed"]);
    expect(detail.counts).toMatchObject({ passed: 3, planned: 3 });

    const h2 = detail.attempts.find((a) => a.testId === "H2")!;
    const doc = (await h.api<ResultDocument>("GET", `/runs/${runId}/attempts/${h2.id}`)).data;
    expect(doc.schemaVersion).toBe(1);
    expect(doc.texts.saved).toBe("hi from H1 attempt 2");
    expect(doc.flags).toEqual([{ name: "fyi", kind: "info", detail: "just so you know", declared: true }]);
    expect(doc.log.map((l) => l.message)).toContain("Step: press the button");
    expect(doc.steps).toEqual([{ title: "press the button", depth: 0, startedAt: expect.any(String), finishedAt: expect.any(String), status: "passed" }]);
    expect(Date.parse(doc.steps[0]!.finishedAt!)).toBeGreaterThanOrEqual(Date.parse(doc.steps[0]!.startedAt));

    const h1 = detail.attempts.find((a) => a.testId === "H1" && a.number === 1)!;
    const doc1 = (await h.api<ResultDocument>("GET", `/runs/${runId}/attempts/${h1.id}`)).data;
    expect(doc1.metrics.attempt).toEqual({ value: 1, unit: "n" });
    expect(doc1.notes).toEqual(["label is custom"]);
    const shot = doc1.artifacts.find((a) => a.kind === "shot")!;
    expect(shot.path).toMatch(/runs\/[0-9a-f]{8}\/H1\/attempt-1\/01-home\.png$/);
    const file = await h.app.inject({ url: shot.url, headers: { host: h.host } });
    expect(file.statusCode).toBe(200);
    expect(file.headers["content-type"]).toBe("image/png");
    expect(file.rawPayload.subarray(1, 4).toString()).toBe("PNG");
    expect(file.headers["accept-ranges"]).toBe("bytes");
    const part = await h.app.inject({ url: shot.url, headers: { host: h.host, range: "bytes=1-3" } });
    expect(part.statusCode).toBe(206);
    expect(part.headers["content-range"]).toBe(`bytes 1-3/${file.rawPayload.length}`);
    expect(part.rawPayload.toString()).toBe("PNG");
    const past = await h.app.inject({ url: shot.url, headers: { host: h.host, range: `bytes=${file.rawPayload.length}-` } });
    expect(past.statusCode).toBe(416);
    // Scroll shots carry their set's name; single shots carry none.
    const set = doc1.artifacts.filter((a) => a.set === "page");
    expect(set.length).toBeGreaterThan(0);
    expect(set[0]!.name).toBe("page 1");
    expect(shot.set).toBeUndefined();
    // The result document is on disk too, next to the files.
    const dataDir = h.app.watchwright.store.dataDir;
    const onDisk = JSON.parse(readFileSync(path.join(dataDir, doc1.folder, "result.json"), "utf8")) as ResultDocument;
    expect(onDisk.attemptId).toBe(h1.id);
    // Passed attempts keep no trace by default; video is there when Playwright's ffmpeg is.
    expect(doc1.artifacts.some((a) => a.kind === "trace")).toBe(false);

    const files = await h.app.inject({ url: "/api/v1/files/runs/../watchwright.db", headers: { host: h.host } });
    expect(files.statusCode).toBe(404);
    const encoded = await h.app.inject({ url: "/api/v1/files/runs/..%2Fwatchwright.db", headers: { host: h.host } });
    expect(encoded.statusCode).toBe(404);
    const percent = await h.app.inject({ url: "/api/v1/files/runs/50%25", headers: { host: h.host } });
    expect(percent.statusCode).toBe(404);
  });

  it("classifies outcomes and skips tests whose needs broke", async () => {
    const { h, packId } = await setup({
      "tests/outcomes.ts": `
import { test, StepError } from "watchwright";
test("F1", async ({ h, expect }) => { await h.goto("/"); await expect(h.page.locator("h1")).toHaveText("Nope", { timeout: 300 }); });
test("F2", async () => { throw new Error("the test code broke"); });
test("F3", async ({ h }) => { h.flag("no-card"); });
test("F4", async ({ h }) => { h.flag("slow", "took 9 s"); });
test("F5", { needs: ["F2"] }, async () => {});
test("F6", async ({ h }) => { h.flag("undeclared"); });
test("F7", async () => { throw new StepError("couldn't find the panel"); });
test("F8", { timeout: 800 }, async ({ h }) => { await h.wait(5000); });`,
    });
    const runId = await startRun(h, { packId, pauseOnBroken: false });
    const detail = await finished(h, runId);
    expect(byTest(detail)).toEqual({
      "F1#1": "failed",
      "F2#1": "broken",
      "F3#1": "broken",
      "F4#1": "failed",
      "F5#1": "skipped",
      "F6#1": "failed",
      "F7#1": "broken",
      "F8#1": "broken",
    });
    const errorKind = (id: string) => detail.attempts.find((a) => a.testId === id)!.error?.kind;
    expect(errorKind("F1")).toBe("assertion");
    expect(errorKind("F2")).toBe("exception");
    expect(errorKind("F7")).toBe("step");
    expect(errorKind("F8")).toBe("timeout");
    const f1 = detail.attempts.find((a) => a.testId === "F1")!;
    const doc = (await h.api<ResultDocument>("GET", `/runs/${runId}/attempts/${f1.id}`)).data;
    const trace = doc.artifacts.find((a) => a.kind === "trace");
    expect(trace?.path.endsWith("trace.zip")).toBe(true);
    // The trace has DOM snapshots, so the trace viewer shows the page at each action, not just the action list.
    const entries = readZip(path.join(h.app.watchwright.store.dataDir, trace!.path));
    const events = [...entries].filter(([name]) => name.endsWith(".trace")).map(([, data]) => data.toString("utf8")).join("\n");
    expect(events).toContain('"type":"frame-snapshot"');
    const f5 = detail.attempts.find((a) => a.testId === "F5")!;
    expect((await h.api<ResultDocument>("GET", `/runs/${runId}/attempts/${f5.id}`)).data.notes[0]).toMatch(/F2 ended broken/);
  });

  it("pauses at the next step, resumes, and stops after the current test", async () => {
    const { h, packId } = await setup({
      "tests/slow.ts": `
import { test } from "watchwright";
test("S1", async ({ h }) => { for (let i = 0; i < 10; i++) await h.wait(100); });
test("S2", async ({ h }) => { await h.wait(100); });
test("S3", async () => {});`,
    });
    const runId = await startRun(h, { packId });
    await h.waitFor((e) => e.type === "attempt.started" && e.runId === runId);
    expect((await h.api("POST", `/runs/${runId}/pause`)).status).toBe(200);
    expect((await h.api("POST", `/runs/${runId}/pause`)).status).toBe(409);
    const paused = await h.waitFor((e) => e.type === "run.paused" && e.runId === runId);
    expect(paused.data.reason).toBe("manual");
    const live = (await h.api<RunDetail>("GET", `/runs/${runId}`)).data;
    expect(live.status).toBe("paused");
    expect(live.live).toMatchObject({ state: "paused", pauseReason: "manual", testId: "S1" });
    expect((await h.api("POST", `/runs/${runId}/retry`)).status).toBe(409);
    expect((await h.api("POST", `/runs/${runId}/resume`)).status).toBe(200);
    await h.api("POST", `/runs/${runId}/stop`, { when: "after" });
    const detail = await finished(h, runId);
    expect(detail.status).toBe("stopped");
    expect(byTest(detail)).toEqual({ "S1#1": "passed" });
    expect(detail.plan.find((p) => p.testId === "S3")?.status).toBe("pending");
  });

  it("pauses on a broken attempt, picks up the fixed test file and retries by itself", async () => {
    const { h, packId, packDir } = await setup({
      "tests/fix.ts": `import { test } from "watchwright"; test("X1", async ({ h }) => { await h.goto("/"); throw new Error("not fixed yet"); });`,
    });
    const runId = await startRun(h, { packId });
    const paused = await h.waitFor((e) => e.type === "run.paused" && e.runId === runId);
    expect(paused.data.reason).toBe("broken");
    expect(paused.data.deadline).toEqual(expect.any(String));
    rewrite(path.join(packDir, "tests", "fix.ts"), `import { test } from "watchwright"; test("X1", async ({ h }) => { await h.goto("/"); h.note("fixed"); });`);
    const detail = await finished(h, runId);
    expect(byTest(detail)).toEqual({ "X1#1": "passed" });
    const history = (await h.api<{ history: { try: number; status: string; current: boolean }[] }>("GET", `/runs/${runId}?history=true`)).data.history;
    expect(history.map((a) => [a.try, a.status, a.current])).toEqual([
      [1, "broken", false],
      [2, "passed", true],
    ]);
  });

  it("skips a broken attempt on request and by itself after the pause limit", async () => {
    const { h, packId } = await setup({
      "tests/b.ts": `import { test } from "watchwright"; test("B1", async () => { throw new Error("x"); }); test("B2", async () => { throw new Error("y"); }); test("B3", async () => {});`,
    });
    const runId = await startRun(h, { packId, pauseLimitMinutes: 0.05 });
    await h.waitFor((e) => e.type === "run.paused" && e.runId === runId && e.data.reason === "broken");
    expect((await h.api("POST", `/runs/${runId}/skip`)).status).toBe(200);
    const auto = await h.waitFor((e) => e.type === "run.decision" && e.runId === runId && e.data.testId === "B2", 20_000);
    expect(auto.data.decision).toBe("skip");
    const detail = await finished(h, runId);
    expect(byTest(detail)).toEqual({ "B1#1": "broken", "B2#1": "broken", "B3#1": "passed" });
  });

  it("stops now, filing the attempt in progress as stopped", async () => {
    const { h, packId } = await setup({
      "tests/long.ts": `import { test } from "watchwright"; test("L1", async ({ h }) => { await h.goto("/"); await h.page.waitForTimeout(20000); }); test("L2", async () => {});`,
    });
    const runId = await startRun(h, { packId });
    await h.waitFor((e) => e.type === "page.navigated" && e.runId === runId);
    await h.api("POST", `/runs/${runId}/stop`, { when: "now" });
    const detail = await finished(h, runId);
    expect(detail.status).toBe("stopped");
    expect(byTest(detail)).toEqual({ "L1#1": "stopped" });
  });

  it("runs children inside their parent and files them separately", async () => {
    const { h, packId } = await setup({
      "tests/w.ts": `
import { test } from "watchwright";
test("W3", { title: "Parent" }, async ({ h, child }) => {
  await h.goto("/");
  const r = await child("W4");
  h.note("child said " + r);
});
test("W4", { title: "Child", inside: "W3" }, async ({ h, expect }) => {
  await expect(h.page.locator("h1")).toHaveText("Fixture home");
  await h.shot("in-parent");
});`,
    });
    const runId = await startRun(h, { packId, tests: ["W4"] });
    const detail = await finished(h, runId);
    expect(detail.plan.map((p) => [p.testId, p.children])).toEqual([["W3", ["W4"]]]);
    const parent = detail.attempts.find((a) => a.testId === "W3")!;
    const child = detail.attempts.find((a) => a.testId === "W4")!;
    expect([parent.status, child.status, child.parentId]).toEqual(["passed", "passed", parent.id]);
    const doc = (await h.api<ResultDocument>("GET", `/runs/${runId}/attempts/${parent.id}`)).data;
    expect(doc.notes).toEqual(["child said passed"]);
    const childDoc = (await h.api<ResultDocument>("GET", `/runs/${runId}/attempts/${child.id}`)).data;
    expect(childDoc.artifacts.map((a) => a.kind)).toEqual(["shot"]);
  });

  it("resumes an interrupted run after a restart, keeping what was decided", async () => {
    const dataDir = tempDir("ww-data-");
    const files = {
      "tests/r.ts": `
import { test } from "watchwright";
test("R1", async ({ h }) => { await h.goto("/"); });
test("R2", async ({ h }) => { await h.goto("/"); await h.wait(20000); });
test("R3", async () => {});`,
    };
    const first = await setup(files, { dataDir });
    const runId = await startRun(first.h, { packId: first.packId });
    await first.h.waitFor((e) => e.type === "attempt.started" && e.data.testId === "R2");
    await first.h.close(); // the server goes down mid-run

    const second = await startHarness(dataDir);
    harnesses.push(second);
    const before = (await second.api<RunDetail>("GET", `/runs/${runId}`)).data;
    expect(before.status).toBe("interrupted");
    expect(byTest(before)).toEqual({ "R1#1": "passed", "R2#1": "interrupted" });
    // Make R2 quick for the second go.
    rewrite(path.join(first.packDir, "tests", "r.ts"), files["tests/r.ts"].replace("await h.wait(20000);", ""));
    expect((await second.api("POST", `/runs/${runId}/resume`)).status).toBe(200);
    const detail = await finished(second, runId);
    expect(detail.status).toBe("finished");
    expect(byTest(detail)).toEqual({ "R1#1": "passed", "R2#1": "passed", "R3#1": "passed" });
    const history = (await second.api<{ history: { testId: string; try: number }[] }>("GET", `/runs/${runId}?history=true`)).data.history;
    expect(history.filter((a) => a.testId === "R1")).toHaveLength(1);
    expect(history.filter((a) => a.testId === "R2").map((a) => a.try)).toEqual([1, 2]);
  });

  it("redoes only broken attempts and what they need", async () => {
    const { h, packId, packDir } = await setup({
      "tests/d.ts": `
import { test } from "watchwright";
test("D1", async ({ h }) => { h.save("token", "abc"); });
test("D2", { needs: ["D1"] }, async ({ h }) => { if (h.load("token") !== "abc") throw new Error("no token"); throw new Error("broken on purpose"); });
test("D3", async () => {});`,
    });
    const runId = await startRun(h, { packId, pauseOnBroken: false });
    const first = await finished(h, runId);
    expect(byTest(first)).toEqual({ "D1#1": "passed", "D2#1": "broken", "D3#1": "passed" });
    rewrite(path.join(packDir, "tests", "d.ts"), readFileSync(path.join(packDir, "tests", "d.ts"), "utf8").replace(`throw new Error("broken on purpose");`, ""));
    const head = h.app.watchwright.events.head();
    expect((await h.api("POST", `/runs/${runId}/redo-broken`)).status).toBe(200);
    await h.waitFor((e) => e.runId === runId && e.type === "run.finished", 60_000, head);
    await engineOf(h).settled(runId);
    const detail = (await h.api<RunDetail & { history: { testId: string; try: number }[] }>("GET", `/runs/${runId}?history=true`)).data;
    expect(byTest(detail)).toEqual({ "D1#1": "passed", "D2#1": "passed", "D3#1": "passed" });
    expect(detail.history.filter((a) => a.testId === "D3")).toHaveLength(1);
    expect(detail.history.filter((a) => a.testId === "D2")).toHaveLength(2);
    expect((await h.api("POST", `/runs/${runId}/redo-broken`)).status).toBe(409);
  });

  it("streams frames and events over the live WebSocket, and follows new tabs", async () => {
    const { h, packId } = await setup(
      {
        "tests/live.ts": `
import { test } from "watchwright";
test("V1", async ({ h }) => {
  await h.goto("/");
  await h.click("#popup");
  await h.wait(1500);
});`,
      },
      { listen: true },
    );
    const runId = await startRun(h, { packId });
    const ws = new WebSocket(`ws://${h.host}/api/v1/live`);
    const got = { frames: [] as ReturnType<typeof decodeFrame>[], events: [] as string[] };
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => {
        ws.send(JSON.stringify({ type: "subscribe", runId, after: 0, frames: true }));
        resolve();
      });
      ws.once("error", reject);
    });
    ws.on("message", (data: Buffer, isBinary: boolean) => {
      if (isBinary) got.frames.push(decodeFrame(data));
      else {
        const msg = JSON.parse(String(data)) as { type: string; data: { type: string } };
        if (msg.type === "event") got.events.push(msg.data.type);
      }
    });
    await finished(h, runId);
    for (let i = 0; i < 50 && !got.events.includes("run.finished"); i++) await new Promise((r) => setTimeout(r, 20));
    ws.close();
    expect(got.events).toEqual(expect.arrayContaining(["run.queued", "run.started", "attempt.started", "page.opened", "page.active", "attempt.finished", "run.finished"]));
    expect(got.frames.length).toBeGreaterThan(0);
    const f = got.frames[0]!;
    expect(f.runId).toBe(runId);
    expect(f.data.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8])); // JPEG
    expect(new Set(got.frames.map((x) => x.pageId))).toEqual(new Set(["p1", "p2"]));
  });

  it("stores collector records per attempt", async () => {
    const { h, packId } = await setup({
      "tests/noisy.ts": `import { test } from "watchwright"; test("N1", async ({ h }) => { await h.goto("/noisy"); await h.idle(); });`,
    });
    const runId = await startRun(h, { packId });
    const detail = await finished(h, runId);
    const doc = (await h.api<ResultDocument>("GET", `/runs/${runId}/attempts/${detail.attempts[0]!.id}`)).data;
    const names = doc.artifacts.filter((a) => a.kind === "collector").map((a) => a.name);
    expect(names.sort()).toEqual(["console-errors", "failed-requests"]);
    const dataDir = h.app.watchwright.store.dataDir;
    const errors = JSON.parse(readFileSync(path.join(dataDir, doc.folder, "collectors", "console-errors.json"), "utf8")) as { text: string }[];
    expect(errors.map((e) => e.text)).toContain("fixture console error");
  });

  it("runs a child with several parents once per number, caps it by its own runs, and files unrun ones", async () => {
    const { h, packId } = await setup({
      "tests/p.ts": `
import { test } from "watchwright";
test("P1", { runs: 2 }, async ({ h, child, attempt }) => { await h.goto("/"); if (attempt === 2) h.note("P1#2 said " + (await child("P12"))); });
test("P2", { runs: 2 }, async ({ h, child }) => { await h.goto("/"); h.note("P2 said " + (await child("P12"))); });
test("P12", { inside: ["P1", "P2"], runs: 2 }, async ({ h }) => { await h.goto("/other"); });
test("W20", { runs: 3 }, async ({ child, last }) => { if (last) await child("W21"); });
test("W21", { inside: "W20", runs: 2 }, async () => {});`,
    });
    const runId = await startRun(h, { packId, tests: ["P1", "P2", "W21"] });
    const detail = await finished(h, runId);
    const p12 = detail.attempts.filter((a) => a.testId === "P12");
    const parentOf = (id: string | null) => detail.attempts.find((a) => a.id === id)?.testId;
    // #1: P1#1 doesn't call it, P2#1 runs it. #2: P1#2 runs it first, so P2#2 gets its outcome without running it again.
    expect(p12.map((a) => [a.number, a.status, parentOf(a.parentId)]).sort()).toEqual([
      [1, "passed", "P2"],
      [2, "passed", "P1"],
    ]);
    const notes = async (testId: string, n: number) =>
      (await h.api<ResultDocument>("GET", `/runs/${runId}/attempts/${detail.attempts.find((a) => a.testId === testId && a.number === n)!.id}`)).data.notes;
    expect(await notes("P2", 2)).toEqual(["P2 said passed"]);
    // W21 runs 2 of W20's 3 attempts at most; W20 calls it only on its last (3), past the cap: both numbers end up filed as skipped.
    const w21 = detail.attempts.filter((a) => a.testId === "W21").map((a) => [a.number, a.status]);
    expect(w21.sort()).toEqual([
      [1, "skipped"],
      [2, "skipped"],
    ]);
  });

  it("gives attempt hooks, collector hooks, run info, packDir and h.skip to packs", async () => {
    const packDir = tempDir("ww-pack-");
    writeFiles(packDir, {
      "pack.ts": packFiles(`
  setup: async ({ info, packDir }) => { info("App version", "1.2.3"); info("has notes", packDir.length > 0); },
  beforeAttempt: async ({ h, test }) => { if (test.tags.includes("risky")) h.log("backed up before " + test.id); },
  afterAttempt: async ({ h, test, outcome }) => { h.log("after " + test.id + ": " + outcome); },
  collectors: [{
    name: "app-log",
    beginAttempt: (a) => { a.record({ began: a.testId }); },
    endAttempt: (a) => { a.file("calls/01-call.md", "# call of " + a.testId, "text/markdown; charset=utf-8"); a.metric("AI calls", 1); },
  }],`).replace("collectors: [consoleErrors(), failedRequests()],", ""),
      "notes.txt": "next to the pack",
      "tests/a.ts": `
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "watchwright";
test("A1", { tags: ["risky"], description: "Reads a file next to the pack." }, async ({ h, packDir }) => { h.keepText("notes", { text: readFileSync(join(packDir, "notes.txt"), "utf8") }); h.info("model", "fake-9b"); });
test("A2", async ({ h }) => { h.skip("No image to attach."); });
test("A3", { inside: "A1" }, async () => {});`,
    });
    const h = await startHarness(tempDir("ww-data-"));
    harnesses.push(h);
    const packId = (await h.api<{ id: string }>("POST", "/packs", { path: packDir })).data.id;
    const pack = (await h.api<{ tests: { id: string; description: string | null; inside: string[] }[] }>("GET", `/packs/${packId}`)).data;
    expect(pack.tests.find((t) => t.id === "A1")?.description).toBe("Reads a file next to the pack.");
    expect(pack.tests.find((t) => t.id === "A3")?.inside).toEqual(["A1"]);

    const runId = await startRun(h, { packId, tests: ["A1", "A2"] });
    const detail = await finished(h, runId);
    expect(detail.info).toEqual({ "App version": "1.2.3", "has notes": true, model: "fake-9b" });
    expect(byTest(detail)).toEqual({ "A1#1": "passed", "A2#1": "skipped", "A3#1": "skipped" });
    const a1 = (await h.api<ResultDocument>("GET", `/runs/${runId}/attempts/${detail.attempts.find((a) => a.testId === "A1")!.id}`)).data;
    expect(a1.texts.notes).toBe("next to the pack");
    expect(a1.log.map((l) => l.message)).toEqual(expect.arrayContaining(["backed up before A1", "after A1: passed"]));
    expect(a1.metrics["AI calls"]).toEqual({ value: 1, unit: null });
    const file = a1.artifacts.find((a) => a.kind === "file")!;
    expect([file.name, file.contentType, file.path.endsWith("collectors/app-log/calls/01-call.md")]).toEqual(["app-log: calls/01-call.md", "text/markdown; charset=utf-8", true]);
    const records = JSON.parse(readFileSync(path.join(h.app.watchwright.store.dataDir, a1.folder, "collectors", "app-log.json"), "utf8")) as unknown[];
    expect(records).toEqual([{ began: "A1" }]);
    const a2 = (await h.api<ResultDocument>("GET", `/runs/${runId}/attempts/${detail.attempts.find((a) => a.testId === "A2")!.id}`)).data;
    expect(a2.error).toEqual({ kind: "skipped", message: "No image to attach.", stack: null });
  });

  it("files a child's context records under the child, and keeps 0-attempt tests out under an attempts override", async () => {
    const { h, packId } = await setup({
      "tests/c.ts": `
import { test } from "watchwright";
test("C1", async ({ h, child }) => { await h.goto("/"); await child("C2"); await h.goto("/"); });
test("C2", { inside: "C1" }, async ({ h }) => { await h.goto("/noisy"); await h.idle(); });
test("C3", { runs: (p) => (p.label === "hello" ? 0 : 1) }, async () => {});`,
    });
    const runId = await startRun(h, { packId, attempts: 2 });
    const detail = await finished(h, runId);
    expect(Object.keys(byTest(detail)).sort()).toEqual(["C1#1", "C1#2", "C2#1", "C2#2"]);
    const docOf = async (id: string) => (await h.api<ResultDocument>("GET", `/runs/${runId}/attempts/${id}`)).data;
    const parent = await docOf(detail.attempts.find((a) => a.testId === "C1")!.id);
    const child = await docOf(detail.attempts.find((a) => a.testId === "C2")!.id);
    expect(child.artifacts.filter((a) => a.kind === "collector").map((a) => a.name).sort()).toEqual(["console-errors", "failed-requests"]);
    expect(parent.artifacts.filter((a) => a.kind === "collector")).toEqual([]);
  });

  it("waits until a check holds, gives up early when progress stalls, and breaks on a timeout", async () => {
    const { h, packId } = await setup({
      "tests/w.ts": `
import { test } from "watchwright";
test("W1", async ({ h }) => {
  let n = 0;
  h.note("done: " + (await h.waitUntil(() => ++n > 3, { interval: 50 })));
  h.note("stuck: " + (await h.waitUntil(() => false, { progress: () => "same", stallMs: 300, interval: 50 })));
  let tick = 0;
  h.note("moving: " + (await h.waitUntil(() => tick > 12, { progress: () => ++tick, stallMs: 300, interval: 50 })));
});
test("W2", async ({ h }) => { await h.waitUntil(() => false, { timeout: 300, interval: 50, what: "the answer" }); });`,
    });
    const runId = await startRun(h, { packId, pauseOnBroken: false });
    const detail = await finished(h, runId);
    expect(byTest(detail)).toEqual({ "W1#1": "passed", "W2#1": "broken" });
    const w1 = (await h.api<ResultDocument>("GET", `/runs/${runId}/attempts/${detail.attempts[0]!.id}`)).data;
    expect(w1.notes).toEqual(["done: done", "stuck: stalled", "moving: done"]);
    const w2 = (await h.api<ResultDocument>("GET", `/runs/${runId}/attempts/${detail.attempts[1]!.id}`)).data;
    expect(w2.error?.message).toMatch(/for the answer/);
  });

  it("refuses runs it can't start", async () => {
    const { h, packId } = await setup({ "tests/a.ts": `import { test } from "watchwright"; test("A1", async () => {});` });
    expect((await h.api("POST", "/runs", { packId, tests: ["nope"] })).error?.code).toBe("bad_input");
    expect((await h.api("POST", "/runs", { packId, params: { label: 3, other: 1 } })).error?.code).toBe("bad_input");
    expect((await h.api("POST", "/runs", { packId: "00000000" })).status).toBe(404);
    expect((await h.api("POST", "/runs/00000000/pause")).status).toBe(404);
  });
});

(hasFirefox || requireBrowsers ? describe : describe.skip)("engine in Firefox", { timeout: 60_000 }, () => {
  it("runs a pack and streams frames", async () => {
    const packDir = tempDir("ww-pack-");
    writeFiles(packDir, {
      "pack.ts": packFiles("", "firefox"),
      "tests/f.ts": `import { test } from "watchwright"; test("FF1", async ({ h, expect }) => { await h.goto("/"); await h.click("#inc", { done: "text=Count: 1" }); await expect(h.page.locator("#n")).toHaveText("1"); await h.shot("firefox"); });`,
    });
    const h = await startHarness(tempDir("ww-data-"));
    harnesses.push(h);
    let frames = 0;
    const packId = (await h.api<{ id: string }>("POST", "/packs", { path: packDir })).data.id;
    const runId = await startRun(h, { packId });
    const { FRAMES } = await import("../src/plugins/live/hub.js");
    h.app.watchwright.services.get(FRAMES).subscribe(runId, () => frames++);
    const detail = await finished(h, runId);
    expect(byTest(detail)).toEqual({ "FF1#1": "passed" });
    expect(frames).toBeGreaterThan(0);
    expect(existsSync(path.join(h.app.watchwright.store.dataDir, "runs", runId))).toBe(true);
  });
});
