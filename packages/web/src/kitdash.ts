// Sample tiles for #/kit: one of every kind of dashboard tile, with made-up data shaped like the
// server's (GET /packs/:id/dashboard), so each kind can be seen in every look and mode.
import type { Counts, Tile, TileData, TileResult, TileType } from "./dashboard";
import type { HistoryEntry } from "./api";

const DAY = 86_400_000;
const BASE = Date.UTC(2026, 9, 20, 9);
const at = (i: number) => new Date(BASE + i * DAY).toISOString();
const RUNS = Array.from({ length: 8 }, (_, i) => ({ id: `run${i + 1}`, label: `#${i + 41}`, at: at(i) }));

const counts = (passed: number, failed: number, broken = 0): Counts => ({ passed, failed, broken, skipped: 0, stopped: 0 });
const series = (values: (number | null)[], group: string | null = null) => ({ group, points: values.map((value, i) => ({ runId: RUNS[i]!.id, at: RUNS[i]!.at, value, scored: 6, total: 6 })) });
const ref = (i: number, testId: string, title: string) => ({ attemptId: `a${i}${testId}`, runId: RUNS[i]!.id, runLabel: RUNS[i]!.label, at: RUNS[i]!.at, testId, title });
const history = (outcomes: string[]): HistoryEntry[] =>
  outcomes.map((s, i) => ({ attemptId: `h${i}`, runId: RUNS[i]!.id, runLabel: RUNS[i]!.label, number: 1, try: 1, status: s as HistoryEntry["status"], startedAt: RUNS[i]!.at, durationMs: 1200, params: {} }));

function result<K extends TileType>(type: K, title: string, data: TileData[K], tile: Partial<Tile> = {}): TileResult {
  return { tile: { type, arg: true, width: 1, current: true, public: true, ...tile }, title, data: data as unknown as Record<string, unknown>, error: null };
}

export const KIT_TILES: TileResult[] = [
  result("outcome", "Outcomes", { runs: RUNS.map((r, i) => ({ id: r.id, label: r.label, status: "passed", createdAt: r.at, counts: counts(9 - (i % 3), i % 3, i === 5 ? 1 : 0) })) }, { width: 2 }),
  result("metric", "Load ms (median)", { name: "Load ms", unit: "ms", of: "median", goal: { below: 1500 }, series: [series([1320, 1410, 1380, 1620, 1450, 1290, 1350, 1310])] }, { width: 2 }),
  result("stat", "Pass rate", { measure: "passrate", unit: null, goal: null, value: 0.92, previous: 0.85, change: 0.07, better: "high" }),
  result("stat", "Time per test", { measure: "duration", unit: "ms", goal: null, value: 4200, previous: 3900, change: 300, better: "low" }),
  result("score", "Quality", { criterion: "quality", scale: 5, goal: { above: 3.5 }, series: [series([3.2, 3.6, 3.9, 3.4, 4.1, 4.0, 4.3, 4.2])] }, { width: 2 }),
  result("choices", "Severity", { criterion: "severity", choices: ["none", "minor", "major"], runs: RUNS.map((r, i) => ({ runId: r.id, at: r.at, counts: { none: 4 + (i % 3), minor: 2 - (i % 2), major: i % 4 === 0 ? 1 : 0 } })) }),
  result("flags", "Findings", { flag: "finding", series: [series([2, 1, 3, 0, 1, 2, 0, 1])] }),
  result(
    "duration",
    "Run time",
    { runs: RUNS.map((r, i) => ({ runId: r.id, at: r.at, label: r.label, ms: 61_000 + ((i * 7919) % 20_000) })), slowest: [{ testId: "C1", title: "Guest checkout", ms: 14_200, attempts: 8 }, { testId: "S2", title: "Search filters", ms: 9_800, attempts: 8 }] },
    { width: 2 },
  ),
  result(
    "leaderboard",
    "Models",
    {
      by: "model",
      columns: [
        { key: "passrate", label: "Pass rate", better: "high", unit: null },
        { key: "score.quality", label: "quality", better: "high", unit: null },
        { key: "metric.AI s", label: "AI s", better: "low", unit: "s" },
        { key: "runs", label: "Runs", better: null, unit: null },
      ],
      rows: [
        { value: "alpha", runs: 4, cells: { passrate: 0.94, "score.quality": 4.2, "metric.AI s": 7.1, runs: 4 } },
        { value: "beta", runs: 3, cells: { passrate: 0.88, "score.quality": 3.7, "metric.AI s": 4.8, runs: 3 } },
        { value: "gamma", runs: 1, cells: { passrate: 0.75, "score.quality": null, "metric.AI s": 9.4, runs: 1 } },
      ],
      best: { passrate: "alpha", "score.quality": "alpha", "metric.AI s": "beta", runs: null },
    },
    { width: 2 },
  ),
  result("scatter", "Speed and quality", {
    by: "model",
    x: { key: "metric.AI s", label: "AI s", unit: "s" },
    y: { key: "score.quality", label: "quality", unit: null },
    points: [
      { group: "alpha", x: 7.1, y: 4.2, runs: 4 },
      { group: "beta", x: 4.8, y: 3.7, runs: 3 },
      { group: "gamma", x: 9.4, y: 3.1, runs: 1 },
    ],
  }),
  result(
    "breakdown",
    "Pass rate per section",
    {
      by: "section",
      measure: "passrate",
      label: "Pass rate",
      unit: null,
      better: "high",
      groups: ["alpha", "beta"],
      rows: [
        { key: "Checkout", title: "Checkout", cells: [0.9, 0.8] },
        { key: "Search", title: "Search", cells: [1, 0.95] },
        { key: "Account", title: "Account", cells: [0.7, null] },
      ],
    },
    { width: 2 },
  ),
  result(
    "matrix",
    "Tests by run",
    {
      grids: [
        {
          group: null,
          runs: RUNS.map((r) => ({ id: r.id, label: r.label, at: r.at, status: "passed" })),
          tests: [
            { testId: "H1", title: "Home page", cells: RUNS.map((_, i) => ({ attemptId: `m${i}h`, status: "passed", attempts: 1, flags: 0 })) },
            { testId: "S2", title: "Search filters", cells: RUNS.map((_, i) => ({ attemptId: `m${i}s`, status: i % 3 === 1 ? "failed" : "passed", attempts: 1, flags: i === 4 ? 1 : 0 })) },
            { testId: "C1", title: "Guest checkout", cells: RUNS.map((_, i) => (i === 2 ? null : { attemptId: `m${i}c`, status: i === 5 ? "broken" : "passed", attempts: i === 5 ? 2 : 1, flags: 0 })) },
          ],
        },
      ],
    },
    { width: 2 },
  ),
  result("flaky", "Flaky tests", { tests: [{ testId: "S2", title: "Search filters", flips: 4, outcomes: [], history: history(["passed", "failed", "passed", "passed", "failed", "passed", "failed", "passed"]) }] }),
  result(
    "failures",
    "Latest failures",
    {
      items: [
        { ...ref(7, "S2", "Search filters"), status: "failed", message: "Expected 12 results, got 11.", flags: [] },
        { ...ref(6, "C1", "Guest checkout"), status: "passed", message: null, flags: [{ name: "typo", kind: "finding", detail: "“Chekout” on the button" }] },
      ],
    },
    { width: 2 },
  ),
  result("lowest", "Lowest quality", { by: "quality", highest: false, items: [{ ...ref(7, "C1", "Guest checkout"), status: "passed", value: 2 }, { ...ref(6, "S2", "Search filters"), status: "passed", value: 2.5 }] }),
  result("unreviewed", "Waiting for review", { waiting: 5, total: 24, first: ref(7, "H1", "Home page") }),
  result("value", "Build", { name: "info.build", value: "2026.10.27-3", since: RUNS[5]!.at, runId: RUNS[7]!.id }),
  result("latest", "Latest run", {
    run: { id: RUNS[7]!.id, label: RUNS[7]!.label, status: "passed", createdAt: RUNS[7]!.at, startedBy: "schedule:nightly", params: { browser: "chromium" }, info: { build: "2026.10.27-3" }, durationMs: 72_000, counts: counts(11, 1) },
  }),
  result("output", "summary", { latest: { ...ref(7, "C1", "Guest checkout"), kind: "text", name: "summary", text: "Checkout took 4 steps; the coupon field was found by its label." }, previous: null }),
  result("shot", "home", { latest: null, previous: null }),
  result("note", "About this pack", { markdown: "Smoke tests for the shop. Ask **#qa** when the checkout tests fail twice in a row." }),
  result("links", "Links", { links: [{ preset: "Nightly" }, { compare: "last" }, { url: "https://example.com", label: "The shop" }] }, { width: 2 }),
];
