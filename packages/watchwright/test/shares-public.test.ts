import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ReviewsRepo } from "../src/plugins/reviews/repo.js";
import { RunsRepo } from "../src/plugins/runs/repo.js";
import { cleanTempDirs, tempDir, writeFiles } from "./helpers/fixtures.js";
import { startHarness, type Harness } from "./helpers/harness.js";

// What shares and the public status page show of a pack's dashboard and runs
// (docs/plans/dashboards.md, sections 5 and 6): public tiles only, the run's texts, metrics and
// reviews (reviewers anonymous unless the share names them), and the pack's `share:` block.

const harnesses: Harness[] = [];
afterEach(async () => {
  for (const h of harnesses.splice(0)) await h.close();
  cleanTempDirs();
});

const RUN = "0000000a";

const PACK_YAML = (extra: string) => `name: Shop
site: { key: shop-${Math.random().toString(36).slice(2, 8)}, baseURL: "http://127.0.0.1:9/" }
params:
  model: { default: q9, choices: [q9, opus] }
rubric:
  - { id: quality, title: Quality, scale: 5 }
dashboard:
  tiles:
    - { outcome: true }
    - { metric: Load ms }
    - { score: quality }
    - { stat: passrate }
    - { output: summary }
    - { failures: true }
    - { links: [{ compare: last }] }
    - { note: Internal only, public: false }
${extra}
`;
const TESTS = `tests:
  - { id: C1, title: Checkout, steps: [{ goto: / }] }
`;

async function setup(extra = "") {
  const dataDir = tempDir("ww-data-");
  const h = await startHarness(dataDir);
  harnesses.push(h);
  const dir = tempDir("ww-pack-");
  writeFiles(dir, { "pack.yaml": PACK_YAML(extra), "tests/t.yaml": TESTS });
  const packId = (await h.api<{ id: string }>("POST", "/packs", { path: dir })).data.id;
  const db = h.app.watchwright.store.db;
  const repo = new RunsRepo(db);
  repo.insertRun({ id: RUN, pack_id: packId, pack_name: "Shop", pack_path: dir, site_key: "shop", job_kind: "test", tests: "[]", params: '{"model":"q9"}', options: "{}", label: "nightly", status: "finished", started_by: "web", created_at: "2026-11-01T10:00:00.000Z" });
  const attempt = "00000000000a";
  const folder = `runs/${RUN}/${attempt}`;
  repo.insertAttempt({ id: attempt, runId: RUN, kind: "test", itemId: "C1", title: "Checkout", number: 1, of: 1, parentId: null, folder: () => folder });
  repo.finishAttempt(attempt, { status: "passed", flags: [], metrics: { "Load ms": { value: 1200, unit: "ms" } }, notes: [], texts: { summary: "All good", secret: "token=1" }, log: [], error: null });
  mkdirSync(path.join(dataDir, folder), { recursive: true });
  for (const [kind, name, file] of [
    ["text", "summary", "summary.txt"],
    ["text", "secret", "secret.txt"],
    ["file", "report.md", "report.md"],
  ] as const) {
    writeFileSync(path.join(dataDir, folder, file), name);
    repo.addArtifact(attempt, RUN, { kind, name, contentType: "text/plain", path: `${folder}/${file}`, size: 4 });
  }
  const reviews = new ReviewsRepo(db);
  reviews.save({ runId: RUN, packId, attemptId: attempt, testId: "C1", reviewer: "dana", scores: { quality: 4 }, note: "Fine" });
  reviews.save({ runId: RUN, packId, attemptId: attempt, testId: "C1", reviewer: "lee", scores: { quality: 2 }, note: "" });
  const anon = (url: string) => h.app.inject({ method: "GET", url, headers: { host: h.host } });
  return { h, anon, packId, attempt, folder };
}

type Groups = { title: string | null; tiles: { tile: { type: string }; data: Record<string, unknown> | null }[] }[];
const kinds = (g: Groups | null) => (g ?? []).flatMap((x) => x.tiles.map((t) => t.tile.type));

describe("shared runs", () => {
  it("show the run's own tiles, texts, metrics and reviews with anonymous reviewers", async () => {
    const { h, anon, attempt } = await setup();
    const made = await h.api<{ token: string; names: boolean }>("POST", "/shares", { run: RUN });
    expect(made.data.names).toBe(false);
    const base = `/api/v1/shared/${made.data.token}`;
    const run = (await anon(base)).json().data as { tiles: Groups };
    // Only kinds that read one run, only public ones: no outcome history, no links, no private note.
    expect(kinds(run.tiles)).toEqual(["metric", "score", "stat"]);
    const doc = (await anon(`${base}/attempts/${attempt}`)).json().data;
    expect(doc.texts).toEqual({ summary: "All good", secret: "token=1" });
    expect(doc.metrics["Load ms"].value).toBe(1200);
    expect(doc.reviews.criteria.map((c: { id: string }) => c.id)).toEqual(["quality"]);
    expect(doc.reviews.list.map((r: { reviewer: string; scores: unknown }) => [r.reviewer, r.scores])).toEqual([
      ["Reviewer 1", { quality: 4 }],
      ["Reviewer 2", { quality: 2 }],
    ]);

    const named = await h.api<{ token: string }>("POST", "/shares", { run: RUN, names: true });
    const doc2 = (await anon(`/api/v1/shared/${named.data.token}/attempts/${attempt}`)).json().data;
    expect(doc2.reviews.list.map((r: { reviewer: string }) => r.reviewer)).toEqual(["dana", "lee"]);
  });

  it("keep out what the pack's share block says", async () => {
    const { h, anon, attempt, folder } = await setup("share: { metrics: false, reviews: false, outputs: [secret, report.md] }");
    const made = await h.api<{ token: string }>("POST", "/shares", { run: RUN });
    const base = `/api/v1/shared/${made.data.token}`;
    expect(kinds(((await anon(base)).json().data as { tiles: Groups }).tiles)).toEqual(["stat"]);
    const doc = (await anon(`${base}/attempts/${attempt}`)).json().data;
    expect(doc.texts).toEqual({ summary: "All good" });
    expect(doc.metrics).toEqual({});
    expect(doc.reviews).toBeNull();
    expect(doc.artifacts.map((a: { name: string }) => a.name)).toEqual(["summary"]);
    expect((await anon(`${base}/files/${folder}/secret.txt`)).statusCode).toBe(404);
    expect((await anon(`${base}/files/${folder}/report.md`)).statusCode).toBe(404);
    expect((await anon(`${base}/files/${folder}/summary.txt`)).statusCode).toBe(200);
  });
});

describe("the public status page", () => {
  it("shows each pack's public tiles; what runs made only when its runs open", async () => {
    const { h, anon, packId } = await setup();
    await h.api("POST", "/shares/dashboard", { on: true, packs: [packId] });
    const status = (await anon("/api/v1/public/status")).json().data as { packs: { tiles: Groups }[] };
    expect(kinds(status.packs[0]!.tiles)).toEqual(["outcome", "metric", "score", "stat"]);

    await h.api("POST", "/shares/dashboard", { linkRuns: true });
    const open = (await anon("/api/v1/public/status")).json().data as { packs: { tiles: Groups }[] };
    expect(kinds(open.packs[0]!.tiles)).toEqual(["outcome", "metric", "score", "stat", "output", "failures"]);
    const output = open.packs[0]!.tiles[0]!.tiles.find((t) => t.tile.type === "output")!.data as { latest: { url?: string; path?: string } };
    // Files come from the public run's own address, never the private files route.
    expect(output.latest.url).toBeUndefined();
    expect(output.latest.path).toBeUndefined();

    await h.api("POST", "/shares/dashboard", { tiles: false });
    expect(((await anon("/api/v1/public/status")).json().data as { packs: { tiles: Groups | null }[] }).packs[0]!.tiles).toBeNull();
  });
});
