// A pack's dashboard as the server answers it (GET /packs/:id/dashboard), and the small helpers
// its tiles share: how a measure's value reads, which way is better, and the grid width.
import { compact } from "./chart";
import { duration } from "./format";
import type { HistoryEntry } from "./api";

export type TileType =
  | "outcome"
  | "metric"
  | "score"
  | "choices"
  | "flags"
  | "duration"
  | "stat"
  | "leaderboard"
  | "scatter"
  | "breakdown"
  | "matrix"
  | "flaky"
  | "failures"
  | "lowest"
  | "unreviewed"
  | "value"
  | "shot"
  | "output"
  | "latest"
  | "note"
  | "links";

export type DashLink = { preset: string; label?: string } | { compare: "last" | "previous"; label?: string } | { export: true; label?: string } | { url: string; label: string };

export interface Tile {
  type: TileType;
  arg: string | true;
  title?: string;
  width: number;
  test?: string;
  tests?: string[];
  section?: string;
  tag?: string;
  params?: Record<string, string | number | boolean>;
  split?: string;
  runs?: number;
  current: boolean;
  public: boolean;
  of?: string;
  unit?: string;
  goal?: { below?: number; above?: number };
  kind?: "robot" | "finding" | "info";
  measure?: string;
  columns?: string[];
  x?: string;
  y?: string;
  compare?: "previous";
  limit?: number;
  links?: DashLink[];
}

export interface Dashboard {
  runs: number;
  days?: number;
  filters: string[];
  groups: { title: string | null; tiles: Tile[] }[];
}

export interface TileResult {
  tile: Tile;
  title: string;
  data: Record<string, unknown> | null;
  error: string | null;
}

/** A group of tiles with their data, as the dashboard, the status page and shares answer them. */
export interface TileGroupResult {
  title: string | null;
  tiles: TileResult[];
}

export interface DashboardReply {
  dashboard: Dashboard;
  source: "override" | "pack" | "default";
  packHasOwn: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
  range: { runs: number; days: number | null; from: string | null; to: string | null; count: number };
  filters: { name: string; values: string[]; value: string | null }[];
  groups: { title: string | null; tiles: TileResult[] }[];
}

// The data of each kind of tile, as the server shapes it.
export interface Point {
  runId: string;
  at: string;
  value: number | null;
  scored?: number;
  total?: number;
}
export interface Series {
  group: string | null;
  points: Point[];
}
export type Better = "high" | "low" | null;
export type Counts = Record<"passed" | "failed" | "broken" | "skipped" | "stopped", number>;
export interface AttemptRef {
  attemptId: string;
  runId: string;
  runLabel: string;
  at: string;
  testId: string;
  title: string;
}
export interface RunCard {
  id: string;
  label: string;
  status: string;
  createdAt: string;
  startedBy: string;
  params: Record<string, unknown>;
  info: Record<string, unknown>;
  durationMs: number | null;
  counts: Counts;
}
export interface FileItem extends AttemptRef {
  kind: string;
  name: string;
  text?: string;
  truncated?: boolean;
  contentType?: string;
  size?: number;
  url?: string;
}

export type TileData = {
  outcome: { runs: { id: string; label: string; status: string; createdAt: string; counts: Counts }[] };
  metric: { name: string; unit: string | null; of: string; goal: { below?: number; above?: number } | null; series: Series[] };
  score: { criterion: string | null; scale: number | null; goal: { below?: number; above?: number } | null; series: Series[] };
  choices: { criterion: string; choices: string[]; runs: { runId: string; at: string; counts: Record<string, number> }[] };
  flags: { flag: string | null; series: Series[] };
  duration: { runs: { runId: string; at: string; label: string; ms: number }[]; slowest: { testId: string; title: string; ms: number; attempts: number }[] };
  stat: { measure: string; unit: string | null; goal: { below?: number; above?: number } | null; value: number | null; previous: number | null; change: number | null; better: Better };
  leaderboard: { by: string; columns: { key: string; label: string; better: Better; unit: string | null }[]; rows: { value: string; runs: number; cells: Record<string, number | null> }[]; best: Record<string, string | null> };
  scatter: { by: string; x: { key: string; label: string; unit: string | null }; y: { key: string; label: string; unit: string | null }; points: { group: string; x: number; y: number; runs: number }[] };
  breakdown: { by: string; measure: string; label: string; unit: string | null; better: Better; groups: (string | null)[]; rows: { key: string; title: string; cells: (number | null)[] }[] };
  matrix: {
    grids: {
      group: string | null;
      runs: { id: string; label: string; at: string; status: string }[];
      tests: { testId: string; title: string; cells: ({ attemptId: string; status: string; attempts: number; flags: number } | null)[] }[];
    }[];
  };
  flaky: { tests: { testId: string; title: string; flips: number; outcomes: string[]; history: HistoryEntry[] }[] };
  failures: { items: (AttemptRef & { status: string; message: string | null; flags: { name: string; kind: string; detail: string | null }[] })[] };
  lowest: { by: string | null; highest: boolean; items: (AttemptRef & { status: string; value: number })[] };
  unreviewed: { waiting: number; total: number; first: AttemptRef | null };
  value: { name: string; value: string | null; since: string | null; runId: string | null };
  shot: { latest: FileItem | null; previous: FileItem | null };
  output: { latest: FileItem | null; previous: FileItem | null };
  latest: { run: RunCard | null };
  note: { markdown: string };
  links: { links: DashLink[] };
};

/** A value of a measure in words: a pass rate as a percentage, a duration as time, the rest compact with its unit. */
export function formatValue(v: number | null | undefined, measure: string, unit?: string | null): string {
  if (v === null || v === undefined) return "–";
  if (measure === "passrate") return `${Math.round(v * 100)}%`;
  if (measure === "duration" || unit === "ms") return duration(Math.round(v));
  return unit && unit !== "%" ? `${compact(v)} ${unit}` : compact(v);
}

/** A signed change of a measure: "+12%", "−0.4 s". */
export function formatChange(v: number, measure: string, unit?: string | null): string {
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  return sign + formatValue(Math.abs(v), measure, unit);
}

/** Whether a value meets the tile's goal; null when there is no goal. */
export function meetsGoal(v: number | null | undefined, goal: { below?: number; above?: number } | null | undefined): boolean | null {
  if (!goal || v === null || v === undefined) return null;
  if (goal.below !== undefined && v >= goal.below) return false;
  if (goal.above !== undefined && v <= goal.above) return false;
  return true;
}

/** A measure's short name for a column head: `score.quality` → "quality", `metric.AI s` → "AI s". */
export function measureLabel(m: string): string {
  const fixed: Record<string, string> = { passrate: "Pass rate", runs: "Runs", attempts: "Attempts", duration: "Time per test", score: "Score", flags: "Flagged" };
  if (fixed[m]) return fixed[m];
  const [head, ...rest] = m.split(".");
  return head === "flags" ? `${rest.join(".")} flags` : rest.join(".");
}

/** The share 0–1 of a value between the lowest and highest of its column, for an inline bar. */
export function share(v: number | null, all: readonly (number | null)[]): number {
  const vs = all.filter((x): x is number => x !== null);
  if (v === null || vs.length === 0) return 0;
  const hi = Math.max(...vs, 0);
  const lo = Math.min(...vs, 0);
  return hi === lo ? 1 : (v - lo) / (hi - lo);
}

/** `model=q9,format=json` from the picked filters, for the request. */
export function filterQuery(picked: Record<string, string>): string {
  return Object.entries(picked)
    .filter(([, v]) => v !== "")
    .map(([k, v]) => `${k}=${v}`)
    .join(",");
}

/** A run's name in a tile: its label, else its id. */
export const runName = (r: { label?: string; runLabel?: string; id?: string; runId?: string }) => r.label || r.runLabel || r.id || r.runId || "";
