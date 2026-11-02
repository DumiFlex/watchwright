// A pack's dashboard as the pack file writes it (`dashboard:`), checked and put in one shape
// (docs/plans/dashboards.md, sections 2 to 4). A tile is written as its kind's key with an
// argument (`metric: AI s`, `leaderboard: model`, `matrix: true`) plus fields every tile has
// (`title`, `width`, `test`, `params`, `split`, …) and its kind's own (`of`, `goal`, `columns`, …).

export const TILE_TYPES = [
  "outcome",
  "metric",
  "score",
  "choices",
  "flags",
  "duration",
  "stat",
  "leaderboard",
  "scatter",
  "breakdown",
  "matrix",
  "flaky",
  "failures",
  "lowest",
  "unreviewed",
  "value",
  "shot",
  "output",
  "latest",
  "note",
  "links",
] as const;
export type TileType = (typeof TILE_TYPES)[number];

/** Tiles that show what runs made: public only when the status page's runs open. */
export const MADE_TYPES: readonly TileType[] = ["shot", "output", "failures", "lowest"];

export const AGGREGATES = ["mean", "median", "p90", "sum", "min", "max", "last"] as const;
export type Aggregate = (typeof AGGREGATES)[number];

export type Link = { preset: string; label?: string } | { compare: "last" | "previous"; label?: string } | { export: true; label?: string } | { url: string; label: string };

export interface Tile {
  type: TileType;
  /** The kind key's value: a name (`metric: AI s`), true, or the note's Markdown. */
  arg: string | true;
  title?: string;
  /** 1 to 4 columns. */
  width: number;
  test?: string;
  tests?: string[];
  section?: string;
  tag?: string;
  params?: Record<string, string | number | boolean>;
  split?: string;
  runs?: number;
  /** Only current attempts (default), not earlier tries of redone ones. */
  current: boolean;
  /** Shown on the public status page and in shares (default true). */
  public: boolean;
  // The kinds' own fields.
  of?: Aggregate;
  unit?: string;
  goal?: { below?: number; above?: number };
  /** A flag kind, for `flags` and `failures`. */
  kind?: "robot" | "finding" | "info";
  /** A measure (`score.quality`, `metric.AI s`, `passrate`), for `stat` and `breakdown`. */
  measure?: string;
  columns?: string[];
  x?: string;
  y?: string;
  compare?: "previous";
  /** How many items a list tile shows. */
  limit?: number;
  links?: Link[];
}

/** A tile as a pack writes it: its kind's key with an argument, plus fields (`{ metric: "Load ms", of: "median", width: 2 }`). */
export type TileInput = { [K in TileType]?: string | boolean | Link[] } & {
  title?: string;
  width?: number;
  test?: string;
  tests?: string[];
  section?: string;
  tag?: string;
  params?: Record<string, string | number | boolean>;
  split?: string;
  runs?: number;
  current?: boolean;
  public?: boolean;
  of?: Aggregate;
  unit?: string;
  goal?: { below?: number; above?: number };
  kind?: "robot" | "finding" | "info";
  measure?: string;
  columns?: string[];
  x?: string;
  y?: string;
  compare?: "previous";
  limit?: number;
};

/** A pack's `dashboard` as written in `pack.ts` or `pack.yaml`. */
export interface DashboardInput {
  runs?: number;
  days?: number;
  filters?: string[];
  tiles?: TileInput[];
  groups?: { title?: string; tiles: TileInput[] }[];
}

export interface TileGroup {
  title: string | null;
  tiles: Tile[];
}

export interface Dashboard {
  runs: number;
  days?: number;
  filters: string[];
  groups: TileGroup[];
}

/** What a pack can keep out of shares and the status page (used by the shares plugin). */
export interface ShareOptions {
  texts?: boolean;
  metrics?: boolean;
  reviews?: boolean;
  /** Names of texts and files never shared. */
  outputs?: string[];
}

export const DEFAULT_RUNS = 20;
export const MAX_RUNS = 200;

/** The dashboard of a pack that says nothing: outcomes, durations and the latest failures. */
export const DEFAULT_DASHBOARD: Dashboard = {
  runs: DEFAULT_RUNS,
  filters: [],
  groups: [
    {
      title: null,
      tiles: [
        { type: "outcome", arg: true, width: 2, current: true, public: true },
        { type: "duration", arg: true, width: 2, current: true, public: true },
        { type: "failures", arg: true, width: 4, current: true, public: true },
      ],
    },
  ],
};

/**
 * Measures a `stat`, `leaderboard`, `scatter` or `breakdown` reads: `passrate`, `runs`,
 * `attempts`, `duration`, `score` (every scale criterion), `score.<criterion>`,
 * `metric.<name>`, `flags` (attempts with any flag), `flags.<kind or name>`.
 */
export function measureProblem(m: unknown): string | null {
  if (typeof m !== "string" || m.trim() === "") return "a measure such as score.quality, metric.Load ms, flags.finding or passrate";
  if (["passrate", "runs", "attempts", "duration", "score", "flags"].includes(m)) return null;
  if (/^(score|metric|flags)\..+/.test(m)) return null;
  return `"${m}" isn't a measure: use passrate, runs, attempts, duration, score, score.<criterion>, metric.<name>, flags or flags.<kind or name>`;
}

const COMMON = new Set(["title", "width", "test", "tests", "section", "tag", "params", "split", "runs", "current", "public"]);
const OWN: Record<TileType, readonly string[]> = {
  outcome: [],
  metric: ["of", "unit", "goal"],
  score: ["goal"],
  choices: [],
  flags: ["kind"],
  duration: ["limit"],
  stat: ["measure", "of", "unit", "goal"],
  leaderboard: ["columns"],
  scatter: ["x", "y"],
  breakdown: ["measure"],
  matrix: [],
  flaky: ["limit"],
  failures: ["kind", "limit"],
  lowest: ["limit"],
  unreviewed: [],
  value: [],
  shot: ["compare"],
  output: [],
  latest: [],
  note: [],
  links: [],
};
/** Kinds that need a name (`metric: Load ms`), not `true`. */
const NEEDS_NAME = new Set<TileType>(["metric", "choices", "leaderboard", "scatter", "breakdown", "value", "output", "note", "stat", "lowest"]);

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown) => typeof v === "string" && v.trim() !== "";

/** A tile as written, checked; problems go to `problems` with `at` in front. */
function readTile(raw: unknown, at: string, problems: string[]): Tile | null {
  if (!isObj(raw)) {
    problems.push(`${at} must be a tile, such as { metric: Load ms }.`);
    return null;
  }
  const kinds = Object.keys(raw).filter((k) => (TILE_TYPES as readonly string[]).includes(k));
  if (kinds.length !== 1) {
    const unknown = Object.keys(raw).filter((k) => !COMMON.has(k) && !Object.values(OWN).some((o) => o.includes(k)));
    problems.push(
      kinds.length === 0
        ? `${at} needs one kind (${TILE_TYPES.join(", ")})${unknown.length ? `; "${unknown[0]}" isn't one` : ""}.`
        : `${at} has more than one kind (${kinds.join(", ")}).`,
    );
    return null;
  }
  const type = kinds[0] as TileType;
  const before = problems.length;
  const v = raw[type];
  let arg: string | true;
  if (type === "links") {
    arg = true;
  } else if (v === true) {
    if (NEEDS_NAME.has(type)) problems.push(`${at}: \`${type}\` needs a name, not true.`);
    arg = true;
  } else if (typeof v === "string" && v.trim() !== "") arg = v.trim();
  else {
    problems.push(`${at}: \`${type}\` must be ${NEEDS_NAME.has(type) ? "a name" : "true or a name"}.`);
    arg = true;
  }
  for (const k of Object.keys(raw)) {
    if (k === type || COMMON.has(k) || OWN[type].includes(k)) continue;
    problems.push(`${at}: \`${k}\` isn't a field of a ${type} tile.`);
  }
  const t: Tile = { type, arg, width: 1, current: true, public: true };
  if (raw.title !== undefined) {
    if (!str(raw.title)) problems.push(`${at}: \`title\` must be text.`);
    else t.title = String(raw.title).trim();
  }
  if (raw.width !== undefined) {
    if (!Number.isInteger(raw.width) || (raw.width as number) < 1 || (raw.width as number) > 4) problems.push(`${at}: \`width\` must be 1, 2, 3 or 4.`);
    else t.width = raw.width as number;
  } else if (["leaderboard", "matrix", "breakdown", "failures"].includes(type)) t.width = 2;
  for (const k of ["test", "section", "tag", "split", "unit"] as const) {
    if (raw[k] === undefined) continue;
    if (!str(raw[k])) problems.push(`${at}: \`${k}\` must be a name.`);
    else t[k] = String(raw[k]).trim();
  }
  if (raw.tests !== undefined) {
    if (!Array.isArray(raw.tests) || raw.tests.some((x) => !str(x))) problems.push(`${at}: \`tests\` must be a list of test ids.`);
    else t.tests = (raw.tests as string[]).map((x) => x.trim());
  }
  if (raw.params !== undefined) {
    if (!isObj(raw.params) || Object.values(raw.params).some((x) => !["string", "number", "boolean"].includes(typeof x))) problems.push(`${at}: \`params\` must map names to values.`);
    else t.params = raw.params as Record<string, string | number | boolean>;
  }
  if (raw.runs !== undefined) {
    if (!Number.isInteger(raw.runs) || (raw.runs as number) < 1 || (raw.runs as number) > MAX_RUNS) problems.push(`${at}: \`runs\` must be a whole number from 1 to ${MAX_RUNS}.`);
    else t.runs = raw.runs as number;
  }
  for (const k of ["current", "public"] as const) {
    if (raw[k] === undefined) continue;
    if (typeof raw[k] !== "boolean") problems.push(`${at}: \`${k}\` must be true or false.`);
    else t[k] = raw[k];
  }
  if (raw.of !== undefined) {
    if (!(AGGREGATES as readonly unknown[]).includes(raw.of)) problems.push(`${at}: \`of\` must be ${AGGREGATES.join(", ")}.`);
    else t.of = raw.of as Aggregate;
  }
  if (raw.goal !== undefined) {
    const g = raw.goal;
    if (!isObj(g) || Object.keys(g).some((k) => k !== "below" && k !== "above") || Object.values(g).some((x) => typeof x !== "number") || Object.keys(g).length === 0)
      problems.push(`${at}: \`goal\` must be { below: <number> } or { above: <number> }.`);
    else t.goal = g as { below?: number; above?: number };
  }
  if (raw.kind !== undefined) {
    if (!["robot", "finding", "info"].includes(raw.kind as string)) problems.push(`${at}: \`kind\` must be robot, finding or info.`);
    else t.kind = raw.kind as "robot" | "finding" | "info";
  }
  if (raw.limit !== undefined) {
    if (!Number.isInteger(raw.limit) || (raw.limit as number) < 1 || (raw.limit as number) > 50) problems.push(`${at}: \`limit\` must be a whole number from 1 to 50.`);
    else t.limit = raw.limit as number;
  }
  if (raw.compare !== undefined) {
    if (raw.compare !== "previous") problems.push(`${at}: \`compare\` can only be previous.`);
    else t.compare = "previous";
  }
  const measure = (k: "measure" | "x" | "y") => {
    if (raw[k] === undefined) return;
    const p = measureProblem(raw[k]);
    if (p) problems.push(`${at}: \`${k}\` must be ${p}.`);
    else t[k] = String(raw[k]);
  };
  measure("measure");
  measure("x");
  measure("y");
  if (type === "stat" && arg !== true && t.measure === undefined) {
    // `stat: metric.Load ms` names the measure itself.
    const p = measureProblem(arg);
    if (p) problems.push(`${at}: \`stat\` must be ${p}.`);
    else t.measure = arg;
  }
  if (type === "scatter" && (t.x === undefined || t.y === undefined)) problems.push(`${at}: a scatter tile needs \`x\` and \`y\` measures.`);
  if (type === "breakdown" && !["section", "tag", "test"].includes(String(arg))) problems.push(`${at}: \`breakdown\` must be section, tag or test.`);
  if (type === "lowest" && arg !== true && !String(arg).startsWith("metric.") && String(arg).includes(".")) problems.push(`${at}: \`lowest\` must be a criterion id or metric.<name>.`);
  if (raw.columns !== undefined) {
    if (!Array.isArray(raw.columns) || raw.columns.length === 0 || raw.columns.length > 12) problems.push(`${at}: \`columns\` must be a list of 1 to 12 measures.`);
    else
      for (const c of raw.columns) {
        const p = measureProblem(c);
        if (p) problems.push(`${at}: column ${p}.`);
      }
    if (problems.length === before) t.columns = (raw.columns as string[]).map(String);
  }
  if (type === "links") {
    const list = v;
    if (!Array.isArray(list) || list.length === 0) problems.push(`${at}: \`links\` must be a list such as [{ preset: Nightly }, { compare: last }, { export: true }, { url: https://…, label: App }].`);
    else {
      const out: Link[] = [];
      for (const [i, l] of list.entries()) {
        const ok =
          isObj(l) &&
          ((str(l.preset) && Object.keys(l).every((k) => k === "preset" || k === "label")) ||
            ((l.compare === "last" || l.compare === "previous") && Object.keys(l).every((k) => k === "compare" || k === "label")) ||
            (l.export === true && Object.keys(l).every((k) => k === "export" || k === "label")) ||
            (str(l.url) && /^https?:\/\//.test(String(l.url)) && str(l.label) && Object.keys(l).every((k) => k === "url" || k === "label")));
        if (!ok) problems.push(`${at}: link ${i + 1} must be { preset }, { compare: last }, { export: true } or { url: https://…, label }.`);
        else out.push(l as Link);
      }
      t.links = out;
    }
  }
  return problems.length === before ? t : null;
}

function readTiles(raw: unknown, at: string, problems: string[]): Tile[] {
  if (!Array.isArray(raw)) {
    problems.push(`${at} must be a list of tiles.`);
    return [];
  }
  return raw.map((t, i) => readTile(t, `${at} ${i + 1}`, problems)).filter((t): t is Tile => t !== null);
}

/** Reads a `dashboard:` block; `problems` gets one line per mistake. */
export function readDashboard(raw: unknown, problems: string[], where = "dashboard"): Dashboard | null {
  if (raw === undefined || raw === null) return null;
  if (!isObj(raw)) {
    problems.push(`\`${where}\` must be an object with \`tiles\` or \`groups\`.`);
    return null;
  }
  const before = problems.length;
  for (const k of Object.keys(raw)) if (!["runs", "days", "filters", "tiles", "groups"].includes(k)) problems.push(`\`${where}.${k}\` isn't a dashboard field (runs, days, filters, tiles, groups).`);
  const d: Dashboard = { runs: DEFAULT_RUNS, filters: [], groups: [] };
  if (raw.runs !== undefined) {
    if (!Number.isInteger(raw.runs) || (raw.runs as number) < 1 || (raw.runs as number) > MAX_RUNS) problems.push(`\`${where}.runs\` must be a whole number from 1 to ${MAX_RUNS}.`);
    else d.runs = raw.runs as number;
  }
  if (raw.days !== undefined) {
    if (!Number.isInteger(raw.days) || (raw.days as number) < 1 || (raw.days as number) > 3650) problems.push(`\`${where}.days\` must be a whole number of days.`);
    else d.days = raw.days as number;
  }
  if (raw.filters !== undefined) {
    if (!Array.isArray(raw.filters) || raw.filters.some((f) => !str(f))) problems.push(`\`${where}.filters\` must be a list of param names.`);
    else d.filters = (raw.filters as string[]).map((f) => f.trim());
  }
  if (raw.tiles !== undefined && raw.groups !== undefined) problems.push(`\`${where}\` has \`tiles\` or \`groups\`, not both.`);
  if (raw.tiles !== undefined) d.groups = [{ title: null, tiles: readTiles(raw.tiles, `\`${where}.tiles\` entry`, problems) }];
  else if (raw.groups !== undefined) {
    if (!Array.isArray(raw.groups)) problems.push(`\`${where}.groups\` must be a list of { title, tiles }.`);
    else
      for (const [i, g] of raw.groups.entries()) {
        const at = `\`${where}.groups\` entry ${i + 1}`;
        if (!isObj(g) || Object.keys(g).some((k) => k !== "title" && k !== "tiles")) {
          problems.push(`${at} must be { title, tiles }.`);
          continue;
        }
        if (g.title !== undefined && !str(g.title)) problems.push(`${at}: \`title\` must be text.`);
        d.groups.push({ title: str(g.title) ? String(g.title).trim() : null, tiles: readTiles(g.tiles, `${at}, tile`, problems) });
      }
  } else problems.push(`\`${where}\` needs \`tiles\` or \`groups\`.`);
  return problems.length === before ? d : null;
}

/** Reads a `share:` block. */
export function readShare(raw: unknown, problems: string[]): ShareOptions | null {
  if (raw === undefined || raw === null) return null;
  if (!isObj(raw)) {
    problems.push("`share` must be an object such as { texts: false, outputs: [report.md] }.");
    return null;
  }
  const before = problems.length;
  const out: ShareOptions = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k === "texts" || k === "metrics" || k === "reviews") {
      if (typeof v !== "boolean") problems.push(`\`share.${k}\` must be true or false.`);
      else out[k] = v;
    } else if (k === "outputs") {
      if (!Array.isArray(v) || v.some((x) => !str(x))) problems.push("`share.outputs` must be a list of text or file names.");
      else out.outputs = (v as string[]).map((x) => x.trim());
    } else problems.push(`\`share.${k}\` isn't a share field (texts, metrics, reviews, outputs).`);
  }
  return problems.length === before ? out : null;
}

/** Every tile of a dashboard, in order. */
export const tilesOf = (d: Dashboard): Tile[] => d.groups.flatMap((g) => g.tiles);
