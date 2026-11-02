import { afterEach, describe, expect, it } from "vitest";
import { readDashboard, readShare } from "../src/plugins/packs/dashboard.js";
import type { DashboardResult, TileResult } from "../src/plugins/dashboards/data.js";
import type { PackDashboard } from "../src/plugins/dashboards/plugin.js";
import { ReviewsRepo } from "../src/plugins/reviews/repo.js";
import { RunsRepo, type AttemptStatus } from "../src/plugins/runs/repo.js";
import type { FlagRecord, MetricRecord } from "../src/jobs/recorder.js";
import { cleanTempDirs, tempDir, writeFiles } from "./helpers/fixtures.js";
import { startHarness, type Harness } from "./helpers/harness.js";

// Pack dashboards (docs/plans/dashboards.md): the `dashboard:` block, every tile's data from runs
// written straight into the store (no browser), and the change kept on the server.

const harnesses: Harness[] = [];
afterEach(async () => {
  for (const h of harnesses.splice(0)) await h.close();
  cleanTempDirs();
});

const BENCH = {
  runs: 40,
  filters: ["model"],
  groups: [
    {
      title: "Models",
      tiles: [
        { leaderboard: "model", columns: ["score.correct", "score.quality", "metric.AI s", "flags.finding", "runs"], width: 4 },
        { scatter: "model", x: "metric.AI s", y: "score.quality", width: 2 },
        { breakdown: "section", measure: "score.quality", split: "model", width: 2 },
      ],
    },
    { title: "To look at", tiles: [{ unreviewed: true }, { lowest: "quality", width: 2 }, { failures: true, kind: "finding" }] },
  ],
};

describe("the dashboard block", () => {
  it("reads the bench's and the smoke pack's dashboards from the plan", () => {
    const problems: string[] = [];
    const d = readDashboard(BENCH, problems)!;
    expect(problems).toEqual([]);
    expect(d.runs).toBe(40);
    expect(d.groups.map((g) => g.tiles.map((t) => [t.type, t.arg, t.width]))).toEqual([
      [
        ["leaderboard", "model", 4],
        ["scatter", "model", 2],
        ["breakdown", "section", 2],
      ],
      [
        ["unreviewed", true, 1],
        ["lowest", "quality", 2],
        ["failures", true, 2],
      ],
    ]);
    const smoke = readDashboard({ runs: 15, tiles: [{ matrix: true, split: "format", width: 4 }, { failures: true, width: 2 }, { flaky: true }, { duration: true }] }, problems)!;
    expect(problems).toEqual([]);
    expect(smoke.groups).toHaveLength(1);
    expect(smoke.groups[0]!.title).toBeNull();
  });

  it("says what is wrong, one line per mistake", () => {
    const problems: string[] = [];
    expect(
      readDashboard(
        {
          rows: 3,
          tiles: [
            { metrc: "Load ms" },
            { metric: "Load ms", width: 6, of: "avg" },
            { metric: true },
            { scatter: "model", x: "metric.A" },
            { stat: "speed" },
            { outcome: true, columns: ["passrate"] },
            { leaderboard: "model", columns: ["score.q", "wat"] },
            { links: [{ url: "javascript:alert(1)", label: "x" }] },
          ],
        },
        problems,
      ),
    ).toBeNull();
    expect(problems).toEqual([
      "`dashboard.rows` isn't a dashboard field (runs, days, filters, tiles, groups).",
      expect.stringContaining('`dashboard.tiles` entry 1 needs one kind (outcome, metric,'),
      "`dashboard.tiles` entry 2: `width` must be 1, 2, 3 or 4.",
      "`dashboard.tiles` entry 2: `of` must be mean, median, p90, sum, min, max, last.",
      "`dashboard.tiles` entry 3: `metric` needs a name, not true.",
      "`dashboard.tiles` entry 4: a scatter tile needs `x` and `y` measures.",
      expect.stringContaining('`dashboard.tiles` entry 5: `stat` must be "speed" isn\'t a measure'),
      "`dashboard.tiles` entry 6: `columns` isn't a field of a outcome tile.",
      expect.stringContaining('`dashboard.tiles` entry 7: column "wat" isn\'t a measure'),
      expect.stringContaining("`dashboard.tiles` entry 8: link 1 must be"),
    ]);
    expect(readDashboard({}, (problems.length = 0, problems))).toBeNull();
    expect(problems).toEqual(["`dashboard` needs `tiles` or `groups`."]);
  });

  it("reads the share block", () => {
    const problems: string[] = [];
    expect(readShare({ texts: false, outputs: ["report.md"] }, problems)).toEqual({ texts: false, outputs: ["report.md"] });
    expect(readShare({ texts: "no", files: [] }, problems)).toBeNull();
    expect(problems).toEqual(["`share.texts` must be true or false.", "`share.files` isn't a share field (texts, metrics, reviews, outputs)."]);
  });
});

const PACK_YAML = (dashboard: string) => `name: Bench
site: { key: bench-${Math.random().toString(36).slice(2, 8)}, baseURL: "http://127.0.0.1:9/" }
params:
  model: { default: q9, choices: [q9, opus] }
rubric:
  - { id: quality, title: Quality, scale: 5 }
  - { id: ui, title: UI, choices: [none, minor, major] }
${dashboard}
`;

const TESTS = `tests:
  - id: W1
    title: Wildcard one
    section: Wildcards
    tags: [changes-library]
    steps: [{ goto: / }]
  - id: W2
    title: Wildcard two
    section: Wildcards
    steps: [{ goto: / }]
  - id: C1
    title: Combine
    section: Combines
    steps: [{ goto: / }]
`;

async function setup(dashboard = "") {
  const h = await startHarness(tempDir("ww-data-"));
  harnesses.push(h);
  const dir = tempDir("ww-pack-");
  writeFiles(dir, { "pack.yaml": PACK_YAML(dashboard), "tests/t.yaml": TESTS });
  const added = await h.api<{ id: string; status: string; problems: string[] }>("POST", "/packs", { path: dir });
  const packId = added.data.id;
  const db = h.app.watchwright.store.db;
  const repo = new RunsRepo(db);
  const reviews = new ReviewsRepo(db);
  let n = 0;
  const run = (id: string, day: number, model: string, info: Record<string, unknown> = {}) => {
    repo.insertRun({
      id,
      pack_id: packId,
      pack_name: "Bench",
      pack_path: dir,
      site_key: "bench",
      job_kind: "test",
      tests: "[]",
      params: JSON.stringify({ model }),
      options: "{}",
      label: `run ${day}`,
      status: "finished",
      started_by: "api",
      created_at: `2026-10-${String(day).padStart(2, "0")}T10:00:00.000Z`,
    });
    repo.updateRun(id, { info: JSON.stringify(info), started_at: `2026-10-${String(day).padStart(2, "0")}T10:00:00.000Z`, finished_at: `2026-10-${String(day).padStart(2, "0")}T10:0${day % 10}:00.000Z` });
  };
  const attempt = (
    runId: string,
    test: string,
    status: AttemptStatus,
    o: { ms?: number; metrics?: Record<string, MetricRecord>; flags?: FlagRecord[]; texts?: Record<string, string>; quality?: number; ui?: string; message?: string } = {},
  ) => {
    const id = (++n).toString(16).padStart(12, "0");
    repo.insertAttempt({ id, runId, kind: "test", itemId: test, title: test, number: 1, of: 1, parentId: null, folder: () => `runs/${runId}/${id}` });
    repo.finishAttempt(id, {
      status,
      flags: o.flags ?? [],
      metrics: o.metrics ?? {},
      notes: [],
      texts: o.texts ?? {},
      log: [],
      error: o.message ? { kind: "assertion", message: o.message, stack: null } : null,
    });
    const start = Date.parse(repo.run(runId)!.created_at) + n * 1000;
    db.prepare("UPDATE runs_attempts SET started_at = ?, finished_at = ? WHERE id = ?").run(new Date(start).toISOString(), new Date(start + (o.ms ?? 1000)).toISOString(), id);
    if (o.quality !== undefined || o.ui !== undefined)
      reviews.save({ runId, packId, attemptId: id, testId: test, reviewer: "web", scores: { ...(o.quality !== undefined ? { quality: o.quality } : {}), ...(o.ui ? { ui: o.ui } : {}) }, note: "" });
    return id;
  };
  return { h, packId, repo, run, attempt, added };
}

const tileOf = (d: DashboardResult, type: string, nth = 0): TileResult => d.groups.flatMap((g) => g.tiles).filter((t) => t.tile.type === type)[nth]!;

describe("dashboard data", () => {
  it("shows the default dashboard for a pack without a block", async () => {
    const { h, packId, run, attempt } = await setup();
    run("00000001", 1, "q9");
    attempt("00000001", "W1", "passed");
    attempt("00000001", "W2", "failed", { message: "expected 3\nto be 4" });
    const d = (await h.api<PackDashboard & DashboardResult>("GET", `/packs/${packId}/dashboard`)).data;
    expect(d.source).toBe("default");
    expect(d.groups[0]!.tiles.map((t) => t.tile.type)).toEqual(["outcome", "duration", "failures"]);
    expect(tileOf(d, "outcome").data).toEqual({ runs: [{ id: "00000001", label: "run 1", status: "finished", createdAt: "2026-10-01T10:00:00.000Z", counts: { passed: 1, failed: 1, broken: 0, skipped: 0, stopped: 0 } }] });
    expect(tileOf(d, "failures").data).toMatchObject({ items: [{ testId: "W2", status: "failed", message: "expected 3" }] });
    expect(tileOf(d, "duration").data).toMatchObject({ runs: [{ runId: "00000001", ms: 60_000 }], slowest: [{ testId: "W1" }, { testId: "W2" }] });
  });

  it("works out every kind of tile from runs, attempts and reviews", async () => {
    const tiles = [
      "{ leaderboard: model, columns: [score.quality, metric.AI s, flags.finding, passrate, runs], width: 4 }",
      "{ scatter: model, x: metric.AI s, y: score.quality }",
      "{ breakdown: section, measure: passrate, split: model }",
      "{ metric: AI s, split: model, goal: { below: 5 } }",
      "{ score: quality }",
      "{ choices: ui }",
      "{ flags: finding }",
      "{ stat: passrate, runs: 2 }",
      "{ matrix: true, split: model }",
      "{ flaky: true }",
      "{ failures: true, kind: finding }",
      "{ lowest: quality }",
      "{ lowest: metric.AI s, limit: 1 }",
      "{ unreviewed: true }",
      "{ value: info.app }",
      "{ output: answer }",
      "{ latest: true }",
      '{ note: "Ask **Sam**." }',
      "{ links: [{ compare: last }, { url: https://example.com/, label: App }] }",
      "{ outcome: true, section: Combines }",
      "{ shot: home, compare: previous }",
    ];
    const { h, packId, repo, run, attempt, added } = await setup(`dashboard:\n  runs: 10\n  filters: [model]\n  tiles:\n${tiles.map((t) => `    - ${t}`).join("\n")}`);
    expect(added.data.status).toBe("ok");
    const s = (v: number): Record<string, MetricRecord> => ({ "AI s": { value: v, unit: "s" } });
    const finding: FlagRecord = { name: "wrong-card", kind: "finding", detail: "Showed the wrong card", declared: true };
    run("00000001", 1, "q9", { app: "1.0" });
    const first = attempt("00000001", "W1", "passed", { metrics: s(10), quality: 2, ui: "minor" });
    attempt("00000001", "W2", "failed", { metrics: s(12), flags: [finding], quality: 1 });
    attempt("00000001", "C1", "passed", { metrics: s(8) });
    run("00000002", 2, "opus", { app: "1.1" });
    attempt("00000002", "W1", "passed", { metrics: s(4), quality: 5, ui: "none" });
    attempt("00000002", "W2", "passed", { metrics: s(6), quality: 4 });
    attempt("00000002", "C1", "failed", { metrics: s(5), quality: 4 });
    run("00000003", 3, "q9", { app: "1.1" });
    const third = attempt("00000003", "W1", "passed", { metrics: s(9), texts: { answer: "# Hello" } });
    for (const [runId, id] of [["00000001", first], ["00000003", third]] as const)
      repo.addArtifact(id, runId, { kind: "shot", name: "home.png", contentType: "image/png", path: `runs/${runId}/${id}/home.png`, size: 10, set: "home" });
    attempt("00000003", "W2", "passed", { metrics: s(11), quality: 3 });
    attempt("00000003", "C1", "broken", { metrics: s(7) });

    const d = (await h.api<PackDashboard & DashboardResult>("GET", `/packs/${packId}/dashboard`)).data;
    expect(d.source).toBe("pack");
    expect(d.range).toMatchObject({ runs: 10, count: 3, from: "2026-10-01T10:00:00.000Z", to: "2026-10-03T10:00:00.000Z" });
    expect(d.filters).toEqual([{ name: "model", values: ["opus", "q9"], value: null }]);
    expect(d.groups[0]!.tiles.every((t) => t.error === null)).toBe(true);

    const board = tileOf(d, "leaderboard").data as { rows: { value: string; runs: number; cells: Record<string, number | null> }[]; best: Record<string, string | null>; columns: { key: string; better: string | null; unit: string | null }[] };
    expect(board.rows.map((r) => [r.value, r.runs, r.cells])).toEqual([
      ["opus", 1, { "score.quality": 4.333, "metric.AI s": 5, "flags.finding": 0, passrate: 0.667, runs: 1 }],
      ["q9", 2, { "score.quality": 2, "metric.AI s": 9.5, "flags.finding": 1, passrate: 0.667, runs: 2 }],
    ]);
    expect(board.best).toEqual({ "score.quality": "opus", "metric.AI s": "opus", "flags.finding": "opus", passrate: "q9", runs: null });
    expect(board.columns.find((c) => c.key === "metric.AI s")).toMatchObject({ better: "low", unit: "s" });

    expect((tileOf(d, "scatter").data as { points: unknown[] }).points).toEqual([
      { group: "opus", x: 5, y: 4.333, runs: 1 },
      { group: "q9", x: 9.5, y: 2, runs: 2 },
    ]);
    expect(tileOf(d, "breakdown").data).toMatchObject({
      groups: ["opus", "q9"],
      rows: [
        { key: "Wildcards", cells: [1, 0.75] },
        { key: "Combines", cells: [0, 0.5] },
      ],
    });
    expect(tileOf(d, "metric").data).toMatchObject({
      unit: "s",
      goal: { below: 5 },
      series: [
        { group: "opus", points: [{ runId: "00000002", value: 5 }] },
        { group: "q9", points: [{ runId: "00000001", value: 10 }, { runId: "00000003", value: 9 }] },
      ],
    });
    expect(tileOf(d, "score").data).toMatchObject({
      scale: 5,
      series: [
        {
          group: null,
          points: [
            { runId: "00000001", value: 1.5, scored: 2, total: 3 },
            { runId: "00000002", value: 4.333, scored: 3, total: 3 },
            { runId: "00000003", value: 3, scored: 1, total: 3 },
          ],
        },
      ],
    });
    expect(tileOf(d, "choices").data).toMatchObject({
      choices: ["none", "minor", "major"],
      runs: [{ counts: { none: 0, minor: 1, major: 0 } }, { counts: { none: 1, minor: 0, major: 0 } }, { counts: { none: 0, minor: 0, major: 0 } }],
    });
    expect((tileOf(d, "flags").data as { series: { points: { value: number }[] }[] }).series[0]!.points.map((p) => p.value)).toEqual([1, 0, 0]);
    // Pass rate of the last 2 runs (5 of 6) against the 2 before (only run 1: 2 of 3).
    expect(tileOf(d, "stat").data).toMatchObject({ measure: "passrate", value: 0.667, previous: 0.667, change: 0, better: "high" });

    const matrix = tileOf(d, "matrix").data as { grids: { group: string; runs: { id: string }[]; tests: { testId: string; cells: ({ status: string } | null)[] }[] }[] };
    expect(matrix.grids.map((g) => g.group)).toEqual(["opus", "q9"]);
    expect(matrix.grids[1]!.runs.map((r) => r.id)).toEqual(["00000001", "00000003"]);
    expect(matrix.grids[1]!.tests.map((t) => [t.testId, t.cells.map((c) => c?.status)])).toEqual([
      ["W1", ["passed", "passed"]],
      ["W2", ["failed", "passed"]],
      ["C1", ["passed", "broken"]],
    ]);
    const flaky = (tileOf(d, "flaky").data as { tests: { history: { runId: string; params: unknown }[] }[] }).tests;
    expect(flaky).toMatchObject([
      { testId: "C1", title: "Combine", flips: 1, outcomes: ["passed", "failed", "broken"] },
      { testId: "W2", title: "Wildcard two", flips: 1, outcomes: ["failed", "passed", "passed"] },
    ]);
    expect(flaky[0]!.history.map((e) => e.runId)).toEqual(["00000001", "00000002", "00000003"]);
    expect(flaky[0]!.history[1]).toMatchObject({ status: "failed", params: { model: "opus" }, runLabel: "run 2", try: 1 });
    expect(tileOf(d, "failures").data).toMatchObject({ items: [{ testId: "W2", runId: "00000001", flags: [{ name: "wrong-card", detail: "Showed the wrong card" }] }] });
    expect((tileOf(d, "lowest", 0).data as { items: { testId: string; runId: string; value: number }[] }).items.map((i) => [i.runId, i.testId, i.value])).toEqual([
      ["00000001", "W2", 1],
      ["00000001", "W1", 2],
      ["00000003", "W2", 3],
      ["00000002", "C1", 4],
      ["00000002", "W2", 4],
      ["00000002", "W1", 5],
    ]);
    expect(tileOf(d, "lowest", 1).data).toMatchObject({ highest: true, items: [{ testId: "W2", value: 12 }] });
    expect(tileOf(d, "unreviewed").data).toMatchObject({ waiting: 3, total: 9, first: { runId: "00000001", testId: "C1" } });
    expect(tileOf(d, "value").data).toEqual({ name: "info.app", value: "1.1", since: "2026-10-02T10:00:00.000Z", runId: "00000003" });
    expect(tileOf(d, "output").data).toMatchObject({ latest: { kind: "text", name: "answer", text: "# Hello", runId: "00000003" }, previous: null });
    expect(tileOf(d, "latest").data).toMatchObject({ run: { id: "00000003", params: { model: "q9" }, counts: { passed: 2, broken: 1 } } });
    expect(tileOf(d, "note")).toMatchObject({ title: "Note", data: { markdown: "Ask **Sam**." } });
    expect(tileOf(d, "links").data).toEqual({ links: [{ compare: "last" }, { url: "https://example.com/", label: "App" }] });
    expect(tileOf(d, "shot").data).toMatchObject({
      latest: { runId: "00000003", name: "home.png", url: expect.stringMatching(/^\/api\/v1\/files\/runs\/00000003\//) },
      previous: { runId: "00000001" },
    });
    expect((tileOf(d, "outcome").data as { runs: { counts: Record<string, number> }[] }).runs.map((r) => r.counts.passed)).toEqual([1, 0, 0]);

    // A filter makes every tile read only the runs with that value.
    const q9 = (await h.api<DashboardResult>("GET", `/packs/${packId}/dashboard?filter=model=q9`)).data;
    expect(q9.range.count).toBe(2);
    expect(q9.filters[0]!.value).toBe("q9");
    expect((tileOf(q9, "leaderboard").data as { rows: unknown[] }).rows).toHaveLength(1);
    // A narrower range.
    const last = (await h.api<DashboardResult>("GET", `/packs/${packId}/dashboard?runs=1`)).data;
    expect(last.range).toMatchObject({ runs: 1, count: 1, to: "2026-10-03T10:00:00.000Z" });

    const names = (await h.api<Record<string, unknown>>("GET", `/packs/${packId}/dashboard/names`)).data;
    expect(names).toMatchObject({
      params: ["model"],
      info: ["app"],
      metrics: [{ name: "AI s", unit: "s" }],
      texts: ["answer"],
      flags: [{ name: "wrong-card", kind: "finding" }],
      criteria: [
        { id: "quality", kind: "scale" },
        { id: "ui", kind: "choices" },
      ],
      sections: ["Combines", "Wildcards"],
      tags: ["changes-library"],
    });
  });

  it("keeps a change made on the page until it is reset to the pack's", async () => {
    const { h, packId } = await setup("dashboard: { tiles: [{ matrix: true }] }");
    const saved = await h.api<PackDashboard>("POST", `/packs/${packId}/dashboard`, { runs: 5, tiles: [{ metric: "Load ms", width: 2 }, { note: "Hi" }] });
    expect(saved.status).toBe(200);
    expect(saved.data).toMatchObject({ source: "override", packHasOwn: true, updatedBy: "api", dashboard: { runs: 5 } });
    const got = (await h.api<PackDashboard & DashboardResult>("GET", `/packs/${packId}/dashboard`)).data;
    expect(got.groups[0]!.tiles.map((t) => t.tile.type)).toEqual(["metric", "note"]);

    const bad = await h.api("POST", `/packs/${packId}/dashboard`, { tiles: [{ metric: true }] });
    expect(bad.status).toBe(400);
    expect(bad.error).toMatchObject({ code: "bad_dashboard", detail: { problems: ["`dashboard.tiles` entry 1: `metric` needs a name, not true."] } });

    const reset = await h.api<PackDashboard>("DELETE", `/packs/${packId}/dashboard`);
    expect(reset.data).toMatchObject({ source: "pack", dashboard: { groups: [{ tiles: [{ type: "matrix" }] }] } });
    expect((await h.api("GET", "/packs/ffffffff/dashboard")).status).toBe(404);
  });

  it("refuses a pack whose dashboard block has a mistake, with the reason", async () => {
    const { added } = await setup("dashboard: { tiles: [{ leaderbord: model }] }");
    expect(added.data.status).toBe("error");
    expect(added.data.problems.join("\n")).toContain('`dashboard.tiles` entry 1 needs one kind');
  });
});
