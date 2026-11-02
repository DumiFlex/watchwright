import type { FlagRecord, MetricRecord } from "../../jobs/recorder.js";
import type { AttemptError } from "../../jobs/kind.js";
import { tilesOf, type Aggregate, type Dashboard, type Tile } from "../packs/dashboard.js";
import type { PackSummary } from "../packs/registry.js";
import type { Criterion, Score } from "../packs/rubric.js";
import type { Review } from "../reviews/repo.js";
import { fileUrl } from "../runs/results.js";
import type { AttemptRow, AttemptStatus, RunRow, RunsRepo, RunStatus } from "../runs/repo.js";

// Every tile's numbers for one pack's dashboard, from the runs, attempts, reviews and artifacts
// already in the database (docs/plans/dashboards.md, section 7). Nothing is precomputed: a
// request loads the runs in range once, their attempts and the pack's reviews, and each tile
// reads what it needs.

/** What the data is read from. */
export interface DashboardSource {
  runs: RunsRepo;
  /** The reviews of the pack's runs, and each run's rubric; null when the reviews plugin isn't loaded. */
  reviews: { list(f: { packId: string }): Review[]; rubrics(runId: string): Record<string, Criterion[]> | null } | null;
  pack: PackSummary;
}

export interface DashboardQuery {
  /** Runs back, instead of the dashboard's. */
  runs?: number | undefined;
  /** Days back, instead of the dashboard's (or its run count). */
  days?: number | undefined;
  /** Values picked for the dashboard's filters: only runs with these param values. */
  filters?: Record<string, string> | undefined;
  /** Only this run (a shared run's own tiles): the range and filters don't apply. */
  run?: string | undefined;
  now?: Date;
}

/** One point of a series: a run's value. */
export interface Point {
  runId: string;
  at: string;
  value: number;
}

export interface Series {
  /** The split's value, or null when the tile isn't split. */
  group: string | null;
  points: Point[];
}

export interface RunCard {
  id: string;
  label: string;
  status: RunStatus;
  createdAt: string;
  startedBy: string;
  params: Record<string, unknown>;
  info: Record<string, unknown>;
  durationMs: number | null;
  counts: Record<"passed" | "failed" | "broken" | "skipped" | "stopped", number>;
}

export interface AttemptRef {
  attemptId: string;
  runId: string;
  runLabel: string;
  at: string;
  testId: string;
  title: string;
}

export type TileData = Record<string, unknown>;

export interface TileResult {
  tile: Tile;
  /** A title to show: the tile's own, else one made from its kind and name. */
  title: string;
  data: TileData | null;
  /** Why the tile has no data (a name no run recorded), in words. */
  error: string | null;
}

export interface DashboardResult {
  range: { runs: number; days: number | null; from: string | null; to: string | null; count: number };
  /** The dashboard's filters with the values recent runs used and the one picked. */
  filters: { name: string; values: string[]; value: string | null }[];
  groups: { title: string | null; tiles: TileResult[] }[];
}

const DECIDED_OUTCOMES: readonly AttemptStatus[] = ["passed", "failed", "broken"];
const NONE = "(none)";

interface Att {
  row: AttemptRow;
  run: Run;
  flags: FlagRecord[];
  metrics: Record<string, MetricRecord>;
  texts: Record<string, string>;
  error: AttemptError | null;
  durationMs: number | null;
}

interface Run {
  row: RunRow;
  params: Record<string, unknown>;
  info: Record<string, unknown>;
  /** Every attempt, with the tries that were redone (`current` false). */
  attempts: Att[];
}

function aggregate(values: number[], of: Aggregate): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  switch (of) {
    case "mean":
      return values.reduce((a, b) => a + b, 0) / values.length;
    case "median": {
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
    }
    case "p90":
      return sorted[Math.min(sorted.length - 1, Math.ceil(0.9 * sorted.length) - 1)]!;
    case "sum":
      return values.reduce((a, b) => a + b, 0);
    case "min":
      return sorted[0]!;
    case "max":
      return sorted[sorted.length - 1]!;
    case "last":
      return values[values.length - 1]!;
  }
}

const mean = (v: number[]) => aggregate(v, "mean");
const round = (n: number | null) => (n === null ? null : Math.round(n * 1000) / 1000);

/** A run's value of a param, or (with `info.` in front, or when no param has the name) a fact it saved. */
export function groupOf(run: { params: Record<string, unknown>; info: Record<string, unknown> }, name: string): string {
  const v = name.startsWith("info.") ? run.info[name.slice(5)] : name in run.params ? run.params[name] : run.info[name];
  return v === undefined || v === null || v === "" ? NONE : String(v);
}

const runDuration = (r: RunRow) => (r.started_at && r.finished_at ? Date.parse(r.finished_at) - Date.parse(r.started_at) : null);

/** Works out every tile of `dashboard` for the source's pack. */
export function dashboardData(src: DashboardSource, dashboard: Dashboard, q: DashboardQuery = {}): DashboardResult {
  const now = q.now ?? new Date();
  const tiles = tilesOf(dashboard);
  const days = q.days ?? (q.runs === undefined ? dashboard.days : undefined) ?? null;
  const baseRuns = q.runs ?? dashboard.runs;
  // Stats compare with the runs before, so they need twice as many.
  const want = Math.max(baseRuns, ...tiles.map((t) => t.runs ?? 0)) * (tiles.some((t) => t.type === "stat") ? 2 : 1);
  const since = days !== null ? new Date(now.getTime() - days * 86_400_000).toISOString() : null;
  const statuses: RunStatus[] = ["running", "pausing", "paused", "finished", "stopped", "interrupted", "failed_to_start"];
  const one = q.run !== undefined ? src.runs.run(q.run) : null;
  const rows = q.run !== undefined ? (one && one.pack_id === src.pack.id ? [one] : []) : src.runs.runs({ packId: src.pack.id, statuses, limit: days !== null ? 2000 : Math.min(want, 2000) });

  const parse = (r: RunRow): Run => ({ row: r, params: JSON.parse(r.params) as Record<string, unknown>, info: JSON.parse(r.info ?? "{}") as Record<string, unknown>, attempts: [] });
  const all = rows.map(parse);
  const filters = dashboard.filters.map((name) => {
    const values = [...new Set(all.map((r) => groupOf(r, name)))].filter((v) => v !== NONE).sort();
    const picked = q.filters?.[name];
    return { name, values, value: picked !== undefined && picked !== "" ? picked : null };
  });
  const matching = q.run !== undefined ? all : all.filter((r) => filters.every((f) => f.value === null || groupOf(r, f.name) === f.value));

  // Newest first; with `days`, the ones in range plus as many before for the stats.
  const inRange = q.run !== undefined ? all : since !== null ? matching.filter((r) => r.row.created_at >= since) : matching.slice(0, baseRuns);
  const previousRange = q.run !== undefined ? [] : since !== null ? matching.filter((r) => r.row.created_at < since && r.row.created_at >= new Date(Date.parse(since) - days! * 86_400_000).toISOString()) : matching.slice(baseRuns, baseRuns * 2);

  const tests = new Map(src.pack.tests.map((t, i) => [t.id, { ...t, order: i }]));
  const loaded = new Set<Run>();
  const load = (r: Run): Run => {
    if (loaded.has(r)) return r;
    loaded.add(r);
    r.attempts = src.runs.attempts(r.row.id, true).map((a) => ({
      row: a,
      run: r,
      flags: JSON.parse(a.flags) as FlagRecord[],
      metrics: JSON.parse(a.metrics) as Record<string, MetricRecord>,
      texts: JSON.parse(a.texts) as Record<string, string>,
      error: a.error ? (JSON.parse(a.error) as AttemptError) : null,
      durationMs: a.finished_at ? Date.parse(a.finished_at) - Date.parse(a.started_at) : null,
    }));
    return r;
  };

  const reviews = new Map<string, Review[]>();
  for (const rv of src.reviews?.list({ packId: src.pack.id }) ?? []) {
    const list = reviews.get(rv.attemptId) ?? [];
    list.push(rv);
    reviews.set(rv.attemptId, list);
  }
  const criteria = new Map<string, Criterion>();
  for (const c of src.pack.rubric) criteria.set(c.id, c);
  for (const t of src.pack.tests) for (const c of t.rubric) if (!criteria.has(c.id)) criteria.set(c.id, c);
  const rubricsSeen = new Set<string>();
  const criterion = (id: string, runs: Run[]): Criterion | null => {
    if (criteria.has(id)) return criteria.get(id)!;
    for (const r of runs) {
      if (rubricsSeen.has(r.row.id)) continue;
      rubricsSeen.add(r.row.id);
      for (const list of Object.values(src.reviews?.rubrics(r.row.id) ?? {})) for (const c of list) if (!criteria.has(c.id)) criteria.set(c.id, c);
      if (criteria.has(id)) return criteria.get(id)!;
    }
    return null;
  };

  /** The runs a tile reads, newest first. */
  const runsOf = (t: Tile, before = false): Run[] => {
    let list = before ? previousRange : inRange;
    if (t.runs !== undefined && since === null) list = before ? matching.slice(t.runs, t.runs * 2) : matching.slice(0, t.runs);
    if (t.params) list = list.filter((r) => Object.entries(t.params!).every(([k, v]) => groupOf(r, k) === String(v)));
    return list.map(load);
  };
  /** The attempts of `runs` a tile reads (still running ones too). */
  const attemptsOf = (t: Tile, runs: Run[]): Att[] =>
    runs.flatMap((r) =>
      r.attempts.filter((a) => {
        if (t.current && a.row.current !== 1) return false;
        if (t.test && a.row.item_id !== t.test) return false;
        if (t.tests && !t.tests.includes(a.row.item_id)) return false;
        const info = tests.get(a.row.item_id);
        if (t.section && info?.section !== t.section) return false;
        if (t.tag && !info?.tags.includes(t.tag)) return false;
        // Without a test filter, child tests count only through their parent (as the run's counts do).
        if (!t.test && !t.tests && a.row.parent_id !== null) return false;
        return true;
      }),
    );
  const decided = (list: Att[]) => list.filter((a) => DECIDED_OUTCOMES.includes(a.row.status));
  const ref = (a: Att): AttemptRef => ({ attemptId: a.row.id, runId: a.run.row.id, runLabel: a.run.row.label ?? "", at: a.row.started_at, testId: a.row.item_id, title: a.row.title });

  /** Each reviewer's numeric score on a criterion (a yes is 1, a no 0), or every scale criterion's for null. */
  const scoresOf = (a: Att, id: string | null, runs: Run[]): number[] => {
    const out: number[] = [];
    for (const rv of reviews.get(a.row.id) ?? []) {
      for (const [cid, s] of Object.entries(rv.scores)) {
        if (id !== null && cid !== id) continue;
        const c = criterion(cid, runs);
        if (id === null && c?.kind !== "scale") continue;
        const n = numeric(s);
        if (n !== null) out.push(n);
      }
    }
    return out;
  };
  const numeric = (s: Score): number | null => (typeof s === "number" ? s : typeof s === "boolean" ? (s ? 1 : 0) : null);
  const flagMatches = (f: FlagRecord, which: string | true | undefined) => which === undefined || which === true || f.kind === which || f.name === which;

  /** One measure over a set of attempts (and the runs they came from). */
  const measure = (m: string, list: Att[], runs: Run[], of: Aggregate = "mean"): number | null => {
    if (m === "passrate") {
      const d = decided(list);
      return d.length ? d.filter((a) => a.row.status === "passed").length / d.length : null;
    }
    if (m === "runs") return new Set(list.map((a) => a.run.row.id)).size;
    if (m === "attempts") return list.length;
    if (m === "duration") return aggregate(list.map((a) => a.durationMs).filter((x): x is number => x !== null), of);
    if (m === "score") return mean(list.flatMap((a) => scoresOf(a, null, runs)));
    if (m === "flags") return list.filter((a) => a.flags.length > 0).length;
    const [head, ...rest] = m.split(".");
    const name = rest.join(".");
    if (head === "score") return mean(list.flatMap((a) => scoresOf(a, name, runs)));
    if (head === "metric") return aggregate(list.map((a) => a.metrics[name]?.value).filter((x): x is number => typeof x === "number"), of);
    if (head === "flags") return list.filter((a) => a.flags.some((f) => flagMatches(f, name))).length;
    return null;
  };
  /** Higher is better (scores, pass rate), lower is better (times, metrics, flags), or neither. */
  const better = (m: string): "high" | "low" | null => (m === "passrate" || m.startsWith("score") ? "high" : m === "runs" || m === "attempts" ? null : "low");

  /** Runs oldest first, split into groups when the tile says so. */
  const groups = (t: Tile, runs: Run[]): { group: string | null; runs: Run[] }[] => {
    const ordered = [...runs].reverse();
    if (!t.split) return [{ group: null, runs: ordered }];
    const by = new Map<string, Run[]>();
    for (const r of ordered) {
      const g = groupOf(r, t.split);
      by.set(g, [...(by.get(g) ?? []), r]);
    }
    return [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([group, list]) => ({ group, runs: list }));
  };
  const series = (t: Tile, runs: Run[], value: (r: Run, list: Att[]) => number | null): Series[] =>
    groups(t, runs).map(({ group, runs: list }) => ({
      group,
      points: list.flatMap((r) => {
        const v = value(r, attemptsOf(t, [r]));
        return v === null ? [] : [{ runId: r.row.id, at: r.row.created_at, value: round(v)! }];
      }),
    }));

  const card = (r: Run): RunCard => {
    const counts = { passed: 0, failed: 0, broken: 0, skipped: 0, stopped: 0 };
    for (const a of r.attempts) if (a.row.current === 1 && a.row.parent_id === null && a.row.status in counts) counts[a.row.status as keyof typeof counts]++;
    return { id: r.row.id, label: r.row.label ?? "", status: r.row.status, createdAt: r.row.created_at, startedBy: r.row.started_by, params: r.params, info: r.info, durationMs: runDuration(r.row), counts };
  };

  const compute = (t: Tile): TileData => {
    const runs = runsOf(t);
    const name = t.arg === true ? null : t.arg;
    switch (t.type) {
      case "outcome":
        return {
          runs: [...runs].reverse().map((r) => {
            const c = card(r);
            if (t.test || t.tests || t.section || t.tag) {
              for (const k of Object.keys(c.counts) as (keyof RunCard["counts"])[]) c.counts[k] = 0;
              for (const a of attemptsOf(t, [r])) if (a.row.status in c.counts) c.counts[a.row.status as keyof RunCard["counts"]]++;
            }
            return { id: c.id, label: c.label, status: c.status, createdAt: c.createdAt, counts: c.counts };
          }),
        };
      case "metric": {
        const unit = t.unit ?? runs.flatMap((r) => attemptsOf(t, [r])).map((a) => a.metrics[name!]?.unit).find((u) => u) ?? null;
        return { name, unit, of: t.of ?? "mean", goal: t.goal ?? null, series: series(t, runs, (_r, list) => measure(`metric.${name}`, list, runs, t.of ?? "mean")) };
      }
      case "score": {
        const c = name ? criterion(name, runs) : null;
        return {
          criterion: name,
          scale: c?.kind === "scale" ? c.scale : c?.kind === "yesNo" ? 1 : null,
          goal: t.goal ?? null,
          series: groups(t, runs).map(({ group, runs: list }) => ({
            group,
            points: list.flatMap((r) => {
              const atts = decided(attemptsOf(t, [r]));
              const scored = atts.filter((a) => scoresOf(a, name, runs).length > 0);
              const v = mean(scored.flatMap((a) => scoresOf(a, name, runs)));
              return atts.length === 0 ? [] : [{ runId: r.row.id, at: r.row.created_at, value: round(v), scored: scored.length, total: atts.length }];
            }),
          })),
        };
      }
      case "choices": {
        const c = criterion(name!, runs);
        const choices = c?.kind === "choices" ? c.choices : c?.kind === "yesNo" ? ["yes", "no"] : [];
        return {
          criterion: name,
          choices,
          runs: [...runs].reverse().map((r) => {
            const counts: Record<string, number> = Object.fromEntries(choices.map((x) => [x, 0]));
            for (const a of attemptsOf(t, [r]))
              for (const rv of reviews.get(a.row.id) ?? []) {
                const s = rv.scores[name!];
                if (s === undefined) continue;
                const key = typeof s === "boolean" ? (s ? "yes" : "no") : String(s);
                counts[key] = (counts[key] ?? 0) + 1;
              }
            return { runId: r.row.id, at: r.row.created_at, counts };
          }),
        };
      }
      case "flags":
        return { flag: name ?? t.kind ?? null, series: series(t, runs, (_r, list) => list.filter((a) => a.flags.some((f) => flagMatches(f, name ?? t.kind))).length) };
      case "duration": {
        const byTest = new Map<string, { title: string; ms: number[] }>();
        for (const a of attemptsOf(t, runs)) {
          if (a.durationMs === null) continue;
          const e = byTest.get(a.row.item_id) ?? { title: a.row.title, ms: [] };
          e.ms.push(a.durationMs);
          byTest.set(a.row.item_id, e);
        }
        return {
          runs: [...runs].reverse().flatMap((r) => {
            const ms = runDuration(r.row);
            return ms === null ? [] : [{ runId: r.row.id, at: r.row.created_at, label: r.row.label ?? "", ms }];
          }),
          slowest: [...byTest.entries()]
            .map(([testId, e]) => ({ testId, title: e.title, ms: Math.round(mean(e.ms)!), attempts: e.ms.length }))
            .sort((a, b) => b.ms - a.ms)
            .slice(0, t.limit ?? 5),
        };
      }
      case "stat": {
        const m = t.measure ?? "passrate";
        const value = round(measure(m, attemptsOf(t, runs), runs, t.of ?? "mean"));
        const before = runsOf(t, true);
        const previous = before.length ? round(measure(m, attemptsOf(t, before), before, t.of ?? "mean")) : null;
        return { measure: m, unit: t.unit ?? unitOf(m, runs), goal: t.goal ?? null, value, previous, change: value !== null && previous !== null ? round(value - previous) : null, better: better(m) };
      }
      case "leaderboard": {
        const columns = t.columns ?? ["passrate", "score", "runs"];
        const by = new Map<string, Run[]>();
        for (const r of runs) by.set(groupOf(r, name!), [...(by.get(groupOf(r, name!)) ?? []), r]);
        const rows = [...by.entries()].map(([value, list]) => {
          const atts = attemptsOf(t, list);
          return { value, runs: list.length, cells: Object.fromEntries(columns.map((c) => [c, round(measure(c, atts, list))])) as Record<string, number | null> };
        });
        const best: Record<string, string | null> = {};
        for (const c of columns) {
          const b = better(c);
          const scored = rows.filter((r) => r.cells[c] !== null);
          best[c] = b === null || scored.length < 2 ? null : scored.reduce((x, y) => ((b === "high" ? y.cells[c]! > x.cells[c]! : y.cells[c]! < x.cells[c]!) ? y : x)).value;
        }
        const first = columns.find((c) => better(c) !== null);
        if (first) rows.sort((a, b) => ((better(first) === "high" ? -1 : 1) * ((a.cells[first] ?? -Infinity) - (b.cells[first] ?? -Infinity))) || a.value.localeCompare(b.value));
        return { by: name, columns: columns.map((key) => ({ key, label: labelOf(key), better: better(key), unit: unitOf(key, runs) })), rows, best };
      }
      case "scatter": {
        const by = new Map<string, Run[]>();
        for (const r of runs) by.set(groupOf(r, name!), [...(by.get(groupOf(r, name!)) ?? []), r]);
        return {
          by: name,
          x: { key: t.x, label: labelOf(t.x!), unit: unitOf(t.x!, runs) },
          y: { key: t.y, label: labelOf(t.y!), unit: unitOf(t.y!, runs) },
          points: [...by.entries()]
            .map(([group, list]) => {
              const atts = attemptsOf(t, list);
              return { group, x: round(measure(t.x!, atts, list)), y: round(measure(t.y!, atts, list)), runs: list.length };
            })
            .filter((p) => p.x !== null && p.y !== null)
            .sort((a, b) => a.group.localeCompare(b.group)),
        };
      }
      case "breakdown": {
        const m = t.measure ?? "passrate";
        const split = groups(t, runs);
        const keys = new Map<string, number>();
        const keyOf = (a: Att): string[] => {
          const info = tests.get(a.row.item_id);
          if (name === "test") return [a.row.item_id];
          if (name === "section") return [info?.section ?? NONE];
          return info?.tags.length ? info.tags : [NONE];
        };
        const cells = new Map<string, Map<string | null, Att[]>>();
        for (const { group, runs: list } of split)
          for (const a of attemptsOf(t, list))
            for (const k of keyOf(a)) {
              if (!keys.has(k)) keys.set(k, name === "test" ? (tests.get(k)?.order ?? 1e6) : keys.size);
              const row = cells.get(k) ?? new Map<string | null, Att[]>();
              row.set(group, [...(row.get(group) ?? []), a]);
              cells.set(k, row);
            }
        return {
          by: name,
          measure: m,
          label: labelOf(m),
          unit: unitOf(m, runs),
          better: better(m),
          groups: split.map((s) => s.group),
          rows: [...keys.entries()]
            .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
            .map(([key]) => ({
              key,
              title: name === "test" ? (tests.get(key)?.title ?? key) : key,
              cells: split.map(({ group, runs: list }) => {
                const atts = cells.get(key)?.get(group) ?? [];
                return atts.length ? round(measure(m, atts, list)) : null;
              }),
            })),
        };
      }
      case "matrix":
        return {
          grids: groups(t, runs).map(({ group, runs: list }) => {
            const ids = new Map<string, string>();
            for (const r of list) for (const a of attemptsOf(t, [r])) if (!ids.has(a.row.item_id)) ids.set(a.row.item_id, a.row.title);
            const ordered = [...ids.keys()].sort((a, b) => (tests.get(a)?.order ?? 1e6) - (tests.get(b)?.order ?? 1e6) || a.localeCompare(b));
            return {
              group,
              runs: list.map((r) => ({ id: r.row.id, label: r.row.label ?? "", at: r.row.created_at, status: r.row.status })),
              tests: ordered.map((testId) => ({
                testId,
                title: tests.get(testId)?.title ?? ids.get(testId) ?? testId,
                cells: list.map((r) => {
                  const atts = attemptsOf(t, [r]).filter((a) => a.row.item_id === testId);
                  if (atts.length === 0) return null;
                  const worst = atts.reduce((x, y) => (rank(y.row.status) > rank(x.row.status) ? y : x));
                  return { attemptId: worst.row.id, status: worst.row.status, attempts: atts.length, flags: atts.reduce((n, a) => n + a.flags.length, 0) };
                }),
              })),
            };
          }),
        };
      case "flaky": {
        // `history` has what the pack page's strip shows: each attempt's run, try, time and params.
        const by = new Map<string, { title: string; history: Att[] }>();
        for (const r of [...runs].reverse())
          for (const a of decided(attemptsOf(t, [r]))) {
            const e = by.get(a.row.item_id) ?? { title: a.row.title, history: [] };
            e.history.push(a);
            by.set(a.row.item_id, e);
          }
        return {
          tests: [...by.entries()]
            .map(([testId, e]) => ({
              testId,
              title: tests.get(testId)?.title ?? e.title,
              flips: e.history.reduce((n, a, i) => n + (i > 0 && (a.row.status === "passed") !== (e.history[i - 1]!.row.status === "passed") ? 1 : 0), 0),
              outcomes: e.history.slice(-20).map((a) => a.row.status),
              history: e.history.slice(-20).map((a) => ({
                attemptId: a.row.id,
                runId: a.run.row.id,
                runLabel: a.run.row.label ?? "",
                number: a.row.number,
                try: a.row.try,
                status: a.row.status,
                startedAt: a.row.started_at,
                durationMs: a.durationMs,
                params: a.run.params,
              })),
            }))
            .filter((x) => x.flips > 0)
            .sort((a, b) => b.flips - a.flips || a.testId.localeCompare(b.testId))
            .slice(0, t.limit ?? 10),
        };
      }
      case "failures": {
        const items = attemptsOf(t, runs)
          .filter((a) => (t.kind ? a.flags.some((f) => f.kind === t.kind) : a.row.status === "failed" || a.row.status === "broken" || a.flags.some((f) => f.kind !== "info")))
          .sort((a, b) => b.row.started_at.localeCompare(a.row.started_at))
          .slice(0, t.limit ?? 10)
          .map((a) => ({
            ...ref(a),
            status: a.row.status,
            message: a.error?.message.split("\n")[0]?.slice(0, 500) ?? null,
            flags: a.flags.filter((f) => !t.kind || f.kind === t.kind).map((f) => ({ name: f.name, kind: f.kind, detail: f.detail })),
          }));
        return { items };
      }
      case "lowest": {
        const metric = name?.startsWith("metric.") ? name.slice(7) : null;
        const items = attemptsOf(t, runs)
          .map((a) => ({ a, value: metric !== null ? (a.metrics[metric]?.value ?? null) : mean(scoresOf(a, name, runs)) }))
          .filter((x): x is { a: Att; value: number } => x.value !== null)
          .sort((x, y) => (metric !== null ? y.value - x.value : x.value - y.value) || y.a.row.started_at.localeCompare(x.a.row.started_at))
          .slice(0, t.limit ?? 10)
          .map(({ a, value }) => ({ ...ref(a), status: a.row.status, value: round(value) }));
        return { by: name, highest: metric !== null, items };
      }
      case "unreviewed": {
        const atts = decided(attemptsOf(t, runs));
        const waiting = atts.filter((a) => !(reviews.get(a.row.id)?.some((rv) => Object.keys(rv.scores).length > 0) ?? false)).sort((a, b) => a.row.started_at.localeCompare(b.row.started_at));
        return { waiting: waiting.length, total: atts.length, first: waiting[0] ? ref(waiting[0]) : null };
      }
      case "value": {
        const v = runs[0] ? groupOf(runs[0], name!) : null;
        let since: string | null = null;
        for (const r of runs) {
          if (groupOf(r, name!) !== v) break;
          since = r.row.created_at;
        }
        return { name, value: v === NONE ? null : v, since, runId: runs[0]?.row.id ?? null };
      }
      case "shot":
      case "output": {
        const found: TileData[] = [];
        for (const a of attemptsOf(t, runs).sort((x, y) => y.row.started_at.localeCompare(x.row.started_at))) {
          if (t.type === "output" && name !== null && a.texts[name] !== undefined) {
            found.push({ ...ref(a), kind: "text", name, text: a.texts[name]!.slice(0, 20_000), truncated: a.texts[name]!.length > 20_000 });
          } else {
            const kinds = t.type === "shot" ? ["shot"] : ["file", "text"];
            const art = src.runs
              .artifacts(a.row.id)
              .filter((x) => kinds.includes(x.kind) && (name === null || x.name === name || x.set === name || x.name.replace(/\.[^.]+$/, "") === name))
              .at(-1);
            if (art) found.push({ ...ref(a), kind: art.kind, name: art.name, contentType: art.contentType, size: art.size, path: art.path, url: fileUrl(art.path) });
          }
          if (found.length >= (t.compare === "previous" ? 2 : 1)) break;
        }
        return { latest: found[0] ?? null, previous: t.compare === "previous" ? (found[1] ?? null) : null };
      }
      case "latest":
        return { run: runs[0] ? card(runs[0]) : null };
      case "note":
        return { markdown: name ?? "" };
      case "links":
        return { links: t.links ?? [] };
    }
  };

  const unitOf = (m: string, runs: Run[]): string | null => {
    if (m === "passrate") return "%";
    if (m === "duration") return "ms";
    if (!m.startsWith("metric.")) return null;
    const n = m.slice(7);
    for (const r of runs) for (const a of r.attempts) if (a.metrics[n]?.unit) return a.metrics[n]!.unit;
    return null;
  };

  return {
    range: {
      runs: baseRuns,
      days,
      from: inRange.at(-1)?.row.created_at ?? null,
      to: inRange[0]?.row.created_at ?? null,
      count: inRange.length,
    },
    filters,
    groups: dashboard.groups.map((g) => ({
      title: g.title,
      tiles: g.tiles.map((tile) => {
        let data: TileData | null = null;
        let error: string | null = null;
        try {
          data = compute(tile);
        } catch (err) {
          error = err instanceof Error ? err.message : String(err);
        }
        return { tile, title: tile.title ?? titleOf(tile), data, error };
      }),
    })),
  };
}

const RANK: Partial<Record<AttemptStatus, number>> = { passed: 1, skipped: 0, running: 2, stopped: 3, interrupted: 3, failed: 5, broken: 4 };
const rank = (s: AttemptStatus) => RANK[s] ?? 0;

/** A measure in words: `score.quality` → "quality", `metric.AI s` → "AI s", `passrate` → "Pass rate". */
export function labelOf(m: string): string {
  const fixed: Record<string, string> = { passrate: "Pass rate", runs: "Runs", attempts: "Attempts", duration: "Time per test", score: "Score", flags: "Flagged" };
  if (fixed[m]) return fixed[m];
  const [head, ...rest] = m.split(".");
  const name = rest.join(".");
  return head === "flags" ? `${name} flags` : name;
}

/** A default title from a tile's kind and name. */
export function titleOf(t: Tile): string {
  const name = t.arg === true ? null : t.arg;
  switch (t.type) {
    case "outcome":
      return "Outcomes";
    case "metric":
      return `${name}${t.of && t.of !== "mean" ? ` (${t.of})` : ""}`;
    case "score":
      return name ? `Score: ${name}` : "Score";
    case "choices":
      return name!;
    case "flags":
      return name ? `${name} flags` : t.kind ? `${t.kind[0]!.toUpperCase()}${t.kind.slice(1)} flags` : "Flags";
    case "duration":
      return "Run time";
    case "stat":
      return labelOf(t.measure ?? "passrate");
    case "leaderboard":
      return `By ${name}`;
    case "scatter":
      return `${labelOf(t.y!)} against ${labelOf(t.x!)}`;
    case "breakdown":
      return `${labelOf(t.measure ?? "passrate")} by ${name}`;
    case "matrix":
      return "Tests by run";
    case "flaky":
      return "Flaky tests";
    case "failures":
      return t.kind ? `Latest ${t.kind}s` : "Latest failures";
    case "lowest":
      return name?.startsWith("metric.") ? `Highest ${name.slice(7)}` : `Lowest ${name ?? "score"}`;
    case "unreviewed":
      return "Waiting for review";
    case "value":
      return name!.replace(/^info\./, "");
    case "shot":
      return name ?? "Latest screenshot";
    case "output":
      return name ?? "Latest output";
    case "latest":
      return "Latest run";
    case "note":
      return "Note";
    case "links":
      return "Links";
  }
}

/** Names a dashboard can use, found in the pack's latest runs (for the Customize picker). */
export interface DashboardNames {
  params: string[];
  info: string[];
  metrics: { name: string; unit: string | null }[];
  texts: string[];
  files: string[];
  shots: string[];
  flags: { name: string; kind: string }[];
  criteria: { id: string; title: string; kind: string }[];
  sections: string[];
  tags: string[];
  tests: { id: string; title: string }[];
}

export function dashboardNames(src: DashboardSource, limit = 50): DashboardNames {
  const params = new Set(Object.keys(src.pack.params));
  const info = new Set<string>();
  const metrics = new Map<string, string | null>();
  const texts = new Set<string>();
  const files = new Set<string>();
  const shots = new Set<string>();
  const flags = new Map<string, string>(Object.entries(src.pack.flags));
  const criteria = new Map<string, Criterion>();
  for (const c of src.pack.rubric) criteria.set(c.id, c);
  for (const t of src.pack.tests) for (const c of t.rubric) if (!criteria.has(c.id)) criteria.set(c.id, c);
  for (const r of src.runs.runs({ packId: src.pack.id, limit })) {
    for (const k of Object.keys(JSON.parse(r.params) as object)) params.add(k);
    for (const k of Object.keys(JSON.parse(r.info ?? "{}") as object)) info.add(k);
    for (const a of src.runs.attempts(r.id)) {
      for (const [k, m] of Object.entries(JSON.parse(a.metrics) as Record<string, MetricRecord>)) if (!metrics.has(k) || (metrics.get(k) === null && m.unit)) metrics.set(k, m.unit);
      for (const k of Object.keys(JSON.parse(a.texts) as object)) texts.add(k);
      for (const f of JSON.parse(a.flags) as FlagRecord[]) if (!flags.has(f.name)) flags.set(f.name, f.kind);
      for (const art of src.runs.artifacts(a.id)) {
        if (art.kind === "shot") shots.add(art.set ?? art.name);
        else if (art.kind === "file") files.add(art.name);
      }
    }
    for (const list of Object.values(src.reviews?.rubrics(r.id) ?? {})) for (const c of list) if (!criteria.has(c.id)) criteria.set(c.id, c);
  }
  const sorted = (s: Iterable<string>) => [...s].sort((a, b) => a.localeCompare(b));
  return {
    params: sorted(params),
    info: sorted(info),
    metrics: sorted(metrics.keys()).map((name) => ({ name, unit: metrics.get(name) ?? null })),
    texts: sorted(texts),
    files: sorted(files),
    shots: sorted(shots),
    flags: sorted(flags.keys()).map((name) => ({ name, kind: flags.get(name)! })),
    criteria: [...criteria.values()].map((c) => ({ id: c.id, title: c.title, kind: c.kind })),
    sections: sorted(new Set(src.pack.tests.map((t) => t.section).filter((s): s is string => !!s))),
    tags: sorted(new Set(src.pack.tests.flatMap((t) => t.tags))),
    tests: src.pack.tests.map((t) => ({ id: t.id, title: t.title })),
  };
}
