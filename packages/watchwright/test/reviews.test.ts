import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Comparison } from "../src/plugins/reviews/compare.js";
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

run("reviews", { timeout: 60_000 }, () => {
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

  it("compares runs of one pack and exports them as Markdown and zip", async () => {
    const packDir = tempDir("ww-pack-");
    writeFiles(packDir, {
      "pack.ts": packFile(`[{ id: "overall", title: "Overall" }]`).replace("rubric:", `params: { size: { choices: ["s", "l"], default: "s" } },\n  rubric:`),
      "tests/t.ts": `
import { test } from "watchwright";
test("A", { title: "Home" }, async ({ h, params, packDir }) => {
  await h.goto("/");
  await h.shot("home");
  await h.keepText("size", { text: String(params.size) });
  await h.file("notes/report.md", "# Report\\n");
  const again = await h.file("notes/report.md", "# Again\\n");
  const copied = await h.file("data.json", { path: packDir + "/data.json" });
  const bytes = await h.file("raw.bin", new Uint8Array([1, 2, 3]));
  const bad = await h.file("../out.txt", "x").then(() => "saved", (e: Error) => e.message);
  await h.keepText("saved", { text: [again, copied, bytes, bad].join(" | ") });
});`,
      "data.json": '{"ok":true}',
    });
    const otherDir = tempDir("ww-pack-");
    writeFiles(otherDir, { "pack.ts": packFile("[]").replace('name: "Reviewed"', 'name: "Other"'), "tests/t.ts": `import { test } from "watchwright";\ntest("Z", { title: "Z" }, async () => {});` });
    const h = await startHarness(tempDir("ww-data-"));
    harnesses.push(h);
    const pack = await h.api<{ id: string }>("POST", "/packs", { path: packDir });
    const other = await h.api<{ id: string }>("POST", "/packs", { path: otherDir });
    const ids: string[] = [];
    for (const [packId, params] of [[pack.data.id, { size: "s" }], [pack.data.id, { size: "l" }], [other.data.id, {}]] as const) {
      const started = await h.api<{ id: string }>("POST", "/runs", { packId, params });
      await h.waitFor((e) => e.runId === started.data.id && e.type === "run.finished", 45_000);
      await engineOf(h).settled(started.data.id);
      ids.push(started.data.id);
    }
    const [r1, r2, r3] = ids as [string, string, string];
    const a1 = (await h.api<RunDetail>("GET", `/runs/${r1}`)).data.attempts[0]!;
    await h.api("POST", `/runs/${r1}/attempts/${a1.id}/review`, { scores: { overall: 4 }, note: "Looks right." });

    const c = await h.api<Comparison>("GET", `/compare?runs=${r1},${r2}`);
    expect(c.status).toBe(200);
    expect(c.data.runs.map((r) => r.params)).toEqual([{ size: "s" }, { size: "l" }]);
    expect(c.data.rows).toHaveLength(1);
    expect(c.data.rows[0]!.cells.map((x) => x?.texts.size)).toEqual(["s", "l"]);
    expect(c.data.rows[0]!.cells[0]!.score).toBe(4);
    expect(c.data.shotNames).toEqual(["home"]);
    // h.file: saved under files/, a repeated name numbered, a copy from disk, bytes, a bad name refused.
    const first = c.data.rows[0]!.cells[0]!;
    expect(first.texts.saved).toBe(`notes/report-2.md | data.json | raw.bin | "../out.txt" isn't a usable file name.`);
    expect(first.files.map((f) => f.at)).toEqual(["02-size.txt", "files/notes/report.md", "files/notes/report-2.md", "files/data.json", "files/raw.bin", "03-saved.txt"]);
    const report = first.files.find((f) => f.at === "files/notes/report.md")!;
    expect(report.name).toBe("notes/report.md");
    const served = await h.app.inject({ method: "GET", url: report.url, headers: { host: h.host } });
    expect(served.headers["content-type"]).toMatch(/text\/markdown/);
    expect(served.body).toBe("# Report\n");

    const mixed = await h.api("GET", `/compare?runs=${r1},${r3}`);
    expect(mixed.status).toBe(400);
    expect(mixed.error?.code).toBe("mixed_packs");
    expect((await h.api("GET", `/compare?runs=${r1},00000000`)).status).toBe(404);
    expect((await h.api("GET", `/compare?runs=nope`)).status).toBe(400);

    // Changes: r2 has no earlier run with its params; against r1 nothing moved.
    type Changes = { previous: { id: string } | null; rows: unknown[]; same: number };
    expect((await h.api<Changes>("GET", `/runs/${r2}/changes`)).data).toEqual({ previous: null, rows: [], same: 0 });
    const vs = await h.api<Changes>("GET", `/runs/${r2}/changes?against=${r1}`);
    expect(vs.data.previous?.id).toBe(r1);
    expect(vs.data).toMatchObject({ rows: [], same: 1 });
    expect((await h.api("GET", `/runs/${r2}/changes?against=${r3}`)).error?.code).toBe("mixed_packs");

    const md = await h.api<{ name: string; markdown: string }>("GET", `/export?runs=${r1}`);
    expect(md.data.name).toBe(`reviewed-${r1}.md`);
    expect(md.data.markdown).toContain("| Overall | 4 / 5 |");
    expect(md.data.markdown).toContain("> **api**: Looks right.");
    expect(md.data.markdown).toMatch(/\[home\]\(\/api\/v1\/files\/runs\//);

    const file = await h.app.inject({ method: "GET", url: `/api/v1/export.md?runs=${r1},${r2}`, headers: { host: h.host } });
    expect(file.statusCode).toBe(200);
    expect(file.headers["content-type"]).toMatch(/text\/markdown/);
    expect(file.headers["content-disposition"]).toBe(`attachment; filename="reviewed-${r1}-${r2}.md"`);
    expect(file.body).toContain(`[home](http://${h.host}/api/v1/files/runs/`);

    const z = await h.app.inject({ method: "GET", url: `/api/v1/export.zip?runs=${r1}`, headers: { host: h.host } });
    expect(z.statusCode).toBe(200);
    expect(z.headers["content-type"]).toBe("application/zip");
    const body = z.rawPayload;
    expect(body.readUInt32LE(0)).toBe(0x04034b50);
    const names = body.toString("latin1");
    expect(names).toContain(`reviewed-${r1}.md`);
    expect(names).toContain(`shots/${r1}/${a1.id}/`);
    expect(names).toContain(`files/${r1}/${a1.id}/files/notes/report-2.md`);
    expect(names).toContain(`files/${r1}/${a1.id}/02-size.txt`);
    const badZip = await h.app.inject({ method: "GET", url: `/api/v1/export.zip?runs=${r1},${r3}`, headers: { host: h.host } });
    expect(badZip.statusCode).toBe(400);
    expect(badZip.json()).toMatchObject({ error: { code: "mixed_packs" } });
  });
});
