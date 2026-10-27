import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { AttemptReviews } from "../src/plugins/reviews/plugin.js";
import type { Review } from "../src/plugins/reviews/repo.js";
import type { RunDetail } from "../src/plugins/runs/engine.js";
import { cleanTempDirs, startSite, tempDir, writeFiles } from "./helpers/fixtures.js";
import { engineOf, hasChromium, requireBrowsers, startHarness, type Harness } from "./helpers/harness.js";

// Reviews against a real run: the rubric a run starts with, saving and merging scores, filters.

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

const packFile = (rubric: string) => `
import { pack } from "watchwright";
export default pack({
  name: "Reviewed",
  site: { key: "reviewed-${Math.random().toString(36).slice(2, 8)}", baseURL: ${JSON.stringify(site?.url ?? "http://127.0.0.1/")} },
  browser: { name: "chromium", viewport: { width: 800, height: 600 } },
  rubric: ${rubric},
});`;

run("reviews", () => {
  it("scores attempts on the rubric the run started with", async () => {
    const packDir = tempDir("ww-pack-");
    writeFiles(packDir, {
      "pack.ts": packFile(`[{ id: "correct", title: "Correct" }, { id: "ui", title: "UI", choices: ["none", "minor", "major"] }]`),
      "tests/t.ts": `
import { test } from "watchwright";
test("A", { title: "Plain" }, async ({ h }) => { await h.goto("/"); });
test("B", { title: "Own rubric", review: { drop: ["ui"], add: [{ id: "usable", title: "Would use it", yesNo: true }] } }, async ({ h }) => { await h.goto("/"); });`,
    });
    const h = await startHarness(tempDir("ww-data-"));
    harnesses.push(h);
    const pack = await h.api<{ id: string; rubric: { id: string }[]; tests: { id: string; rubric: { id: string }[] }[] }>("POST", "/packs", { path: packDir });
    expect(pack.data.rubric.map((c) => c.id)).toEqual(["correct", "ui"]);
    expect(pack.data.tests.find((t) => t.id === "B")!.rubric.map((c) => c.id)).toEqual(["correct", "usable"]);

    const started = await h.api<{ id: string }>("POST", "/runs", { packId: pack.data.id });
    const runId = started.data.id;
    await h.waitFor((e) => e.runId === runId && e.type === "run.finished", 45_000);
    await engineOf(h).settled(runId);
    const detail = (await h.api<RunDetail>("GET", `/runs/${runId}`)).data;
    const a = detail.attempts.find((x) => x.testId === "A")!;
    const b = detail.attempts.find((x) => x.testId === "B")!;

    // The pack's rubric changes after the run; the run keeps the one it started with.
    writeFiles(packDir, { "pack.ts": packFile(`[{ id: "speed", title: "Speed" }]`) });
    await h.api("POST", `/packs/${pack.data.id}/reload`);

    const got = await h.api<AttemptReviews>("GET", `/runs/${runId}/attempts/${b.id}/review`);
    expect(got.data.criteria.map((c) => c.id)).toEqual(["correct", "usable"]);
    expect(got.data.reviews).toEqual([]);
    const rubric = await h.api<Record<string, { id: string }[]>>("GET", `/runs/${runId}/rubric`);
    expect(Object.fromEntries(Object.entries(rubric.data).map(([t, c]) => [t, c.map((x) => x.id)]))).toEqual({ A: ["correct", "ui"], B: ["correct", "usable"] });

    const first = await h.api<Review>("POST", `/runs/${runId}/attempts/${b.id}/review`, { scores: { correct: 4, usable: true }, note: "Fine." });
    expect(first.data).toMatchObject({ testId: "B", reviewer: "api", scores: { correct: 4, usable: true }, note: "Fine." });
    // Scores merge; null clears one; the note stays unless given.
    const second = await h.api<Review>("POST", `/runs/${runId}/attempts/${b.id}/review`, { scores: { correct: 1, usable: null } });
    expect(second.data).toMatchObject({ scores: { correct: 1 }, note: "Fine." });

    const bad = await h.api("POST", `/runs/${runId}/attempts/${a.id}/review`, { scores: { usable: true } });
    expect(bad.status).toBe(400);
    expect(bad.error).toMatchObject({ code: "bad_score" });
    const badValue = await h.api("POST", `/runs/${runId}/attempts/${a.id}/review`, { scores: { correct: true } });
    expect(badValue.error?.message).toMatch(/1 to 5/);
    const missing = await h.api("GET", `/runs/${runId}/attempts/000000000000/review`);
    expect(missing.status).toBe(404);

    // Another reviewer keeps a review of their own.
    const res = await h.app.inject({
      method: "POST",
      url: `/api/v1/runs/${runId}/attempts/${a.id}/review`,
      headers: { host: h.host, "x-watchwright-client": "agent-7" },
      payload: { scores: { ui: "minor" } },
    });
    expect(res.statusCode).toBe(200);
    const all = await h.api<Review[]>("GET", `/reviews?run=${runId}`);
    expect(all.data.map((r) => `${r.testId}:${r.reviewer}`)).toEqual(["A:agent-7", "B:api"]);
    expect((await h.api<Review[]>("GET", `/reviews?reviewer=agent-7`)).data).toHaveLength(1);
    expect((await h.api<Review[]>("GET", `/reviews?pack=${pack.data.id}&test=B`)).data).toHaveLength(1);
    await h.waitFor((e) => e.type === "review.saved" && e.attemptId === b.id);

    // Deleting the run deletes its reviews.
    await h.api("DELETE", `/runs/${runId}`);
    expect((await h.api<Review[]>("GET", `/reviews?run=${runId}`)).data).toEqual([]);
  });
});
