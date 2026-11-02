// Changing a pack's dashboard on its page: what each kind of tile takes (its name and fields),
// the names a pack's runs offer for them (GET /packs/:id/dashboard/names), and the way back from
// a tile as the server reads it to the tile as a pack writes it, which is what a save sends.
import { measureLabel, type Dashboard, type DashLink, type Tile, type TileType } from "./dashboard";

/** Names a pack's tests and latest runs offer, for the pickers (GET /packs/:id/dashboard/names). */
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

export const NO_NAMES: DashboardNames = { params: [], info: [], metrics: [], texts: [], files: [], shots: [], flags: [], criteria: [], sections: [], tags: [], tests: [] };

/** What a kind's name is: nothing (`true`), a pick from the pack's names, Markdown, or a list of links. */
export type ArgKind = "none" | "metric" | "criterion" | "choice" | "flag" | "group" | "measure" | "breakdown" | "lowest" | "shot" | "output" | "markdown" | "links";
/** A kind's own fields, besides the ones every tile has. */
export type OwnField = "of" | "unit" | "goal" | "kind" | "limit" | "measure" | "columns" | "x" | "y" | "compare";

export interface KindInfo {
  type: TileType;
  label: string;
  /** One line on what the tile shows, for the picker. */
  about: string;
  section: "Numbers over time" | "Comparing setups" | "Which tests" | "What runs made" | "Words and links";
  arg: ArgKind;
  /** The kind also takes `true` (every criterion, any flag, any shot) instead of a name. */
  anyAllowed: boolean;
  fields: readonly OwnField[];
}

export const KINDS: readonly KindInfo[] = [
  { type: "outcome", label: "Outcomes", about: "Passed, failed and broken per run", section: "Numbers over time", arg: "none", anyAllowed: true, fields: [] },
  { type: "metric", label: "Metric", about: "One metric per run", section: "Numbers over time", arg: "metric", anyAllowed: false, fields: ["of", "unit", "goal"] },
  { type: "score", label: "Score", about: "The mean review score per run", section: "Numbers over time", arg: "criterion", anyAllowed: true, fields: ["goal"] },
  { type: "choices", label: "Answers", about: "How often each answer of a criterion was given", section: "Numbers over time", arg: "choice", anyAllowed: false, fields: [] },
  { type: "flags", label: "Flags", about: "Attempts that raised a flag, per run", section: "Numbers over time", arg: "flag", anyAllowed: true, fields: [] },
  { type: "duration", label: "Run time", about: "How long each run took, and the slowest tests", section: "Numbers over time", arg: "none", anyAllowed: true, fields: ["limit"] },
  { type: "stat", label: "Number", about: "One number over the runs in range, with its change", section: "Numbers over time", arg: "measure", anyAllowed: false, fields: ["of", "unit", "goal"] },
  { type: "leaderboard", label: "Leaderboard", about: "One row per value of a param", section: "Comparing setups", arg: "group", anyAllowed: false, fields: ["columns"] },
  { type: "scatter", label: "Scatter", about: "Two measures per value of a param", section: "Comparing setups", arg: "group", anyAllowed: false, fields: ["x", "y"] },
  { type: "breakdown", label: "Breakdown", about: "One measure per section, tag or test", section: "Comparing setups", arg: "breakdown", anyAllowed: false, fields: ["measure"] },
  { type: "matrix", label: "Matrix", about: "Each test's outcome in each run", section: "Which tests", arg: "none", anyAllowed: true, fields: [] },
  { type: "flaky", label: "Flaky tests", about: "Tests whose outcome flips most often", section: "Which tests", arg: "none", anyAllowed: true, fields: ["limit"] },
  { type: "failures", label: "Failures", about: "The latest failed or broken attempts", section: "Which tests", arg: "none", anyAllowed: true, fields: ["kind", "limit"] },
  { type: "lowest", label: "Lowest scores", about: "The attempts with the lowest score or highest metric", section: "Which tests", arg: "lowest", anyAllowed: false, fields: ["limit"] },
  { type: "unreviewed", label: "Waiting for review", about: "Attempts that wait for a score", section: "Which tests", arg: "none", anyAllowed: true, fields: [] },
  { type: "value", label: "Value", about: "The latest run's value of a param or fact", section: "What runs made", arg: "group", anyAllowed: false, fields: [] },
  { type: "shot", label: "Screenshot", about: "The latest screenshot with a name", section: "What runs made", arg: "shot", anyAllowed: true, fields: ["compare"] },
  { type: "output", label: "Output", about: "The latest text or file with a name", section: "What runs made", arg: "output", anyAllowed: false, fields: [] },
  { type: "latest", label: "Latest run", about: "The latest run's status, counts and params", section: "What runs made", arg: "none", anyAllowed: true, fields: [] },
  { type: "note", label: "Note", about: "Your words, in Markdown", section: "Words and links", arg: "markdown", anyAllowed: false, fields: [] },
  { type: "links", label: "Links", about: "Buttons to New run, Compare, Export or a page", section: "Words and links", arg: "links", anyAllowed: false, fields: [] },
];

export function kindOf(type: TileType): KindInfo {
  return KINDS.find((k) => k.type === type)!;
}

/** Kinds a pack writes 2 columns wide when it doesn't say. */
const WIDE = new Set<TileType>(["leaderboard", "matrix", "breakdown", "failures"]);

/** A new tile of a kind with a name, as the server would read it. */
export function newTile(type: TileType, arg: string | true, links?: DashLink[]): Tile {
  const t: Tile = { type, arg: type === "links" ? true : arg, width: WIDE.has(type) ? 2 : 1, current: true, public: true };
  if (type === "scatter") Object.assign(t, { x: "passrate", y: "duration" });
  if (type === "links") t.links = links ?? [{ compare: "last" }];
  if (type === "stat" && arg !== true) t.measure = arg;
  return t;
}

type Option = { value: string; label: string; group?: string };

/** The names a kind's name can be, from the pack's names; `""` stands for `true` where a kind takes it. */
export function argOptions(kind: KindInfo, names: DashboardNames): Option[] {
  const any = (label: string): Option[] => (kind.anyAllowed ? [{ value: "", label }] : []);
  const groups = (): Option[] => [...names.params.map((p) => ({ value: p, label: p, group: "Params" })), ...names.info.map((f) => ({ value: `info.${f}`, label: `${f} (fact)`, group: "Facts runs saved" }))];
  switch (kind.arg) {
    case "metric":
      return names.metrics.map((m) => ({ value: m.name, label: m.unit ? `${m.name} (${m.unit})` : m.name }));
    case "criterion":
      return [...any("Every scale criterion"), ...names.criteria.filter((c) => c.kind !== "choices").map((c) => ({ value: c.id, label: c.title }))];
    case "choice":
      return names.criteria.filter((c) => c.kind !== "scale").map((c) => ({ value: c.id, label: c.title }));
    case "flag":
      return [
        ...any("Any flag"),
        ...["finding", "robot", "info"].map((k) => ({ value: k, label: `Every ${k} flag`, group: "Kinds" })),
        ...names.flags.map((f) => ({ value: f.name, label: f.name, group: "Flags" })),
      ];
    case "group":
      return groups();
    case "measure":
      return measureOptions(names);
    case "breakdown":
      return [
        { value: "section", label: "Section" },
        { value: "tag", label: "Tag" },
        { value: "test", label: "Test" },
      ];
    case "lowest":
      return [
        ...names.criteria.filter((c) => c.kind !== "choices").map((c) => ({ value: c.id, label: `Lowest ${c.title}`, group: "Lowest score" })),
        ...names.metrics.map((m) => ({ value: `metric.${m.name}`, label: `Highest ${m.name}`, group: "Highest metric" })),
      ];
    case "shot":
      return [...any("Any screenshot"), ...names.shots.map((s) => ({ value: s, label: s }))];
    case "output":
      return [...names.texts.map((n) => ({ value: n, label: `${n} (text)`, group: "Texts" })), ...names.files.map((n) => ({ value: n, label: n, group: "Files" }))];
    default:
      return any("");
  }
}

/** Every measure the pack's names make: pass rate, scores, metrics, flags, time and counts. */
export function measureOptions(names: DashboardNames): Option[] {
  const out: Option[] = [
    { value: "passrate", label: measureLabel("passrate"), group: "Outcomes" },
    { value: "duration", label: measureLabel("duration"), group: "Outcomes" },
    { value: "runs", label: measureLabel("runs"), group: "Outcomes" },
    { value: "attempts", label: measureLabel("attempts"), group: "Outcomes" },
    { value: "score", label: "Score (every scale criterion)", group: "Scores" },
    ...names.criteria.filter((c) => c.kind !== "choices").map((c) => ({ value: `score.${c.id}`, label: `Score: ${c.title}`, group: "Scores" })),
    ...names.metrics.map((m) => ({ value: `metric.${m.name}`, label: m.unit ? `${m.name} (${m.unit})` : m.name, group: "Metrics" })),
    { value: "flags", label: "Flagged: any flag", group: "Flags" },
    ...["finding", "robot"].map((k) => ({ value: `flags.${k}`, label: `Flagged: ${k}`, group: "Flags" })),
    ...names.flags.map((f) => ({ value: `flags.${f.name}`, label: `Flagged: ${f.name}`, group: "Flags" })),
  ];
  const seen = new Set<string>();
  return out.filter((o) => (seen.has(o.value) ? false : (seen.add(o.value), true)));
}

/** A short name for a tile in the editor's list: its kind and name. */
export function tileLabel(t: Tile): string {
  const k = kindOf(t.type);
  if (t.title) return t.title;
  if (t.type === "note") return "Note";
  if (t.type === "links") return `Links (${t.links?.length ?? 0})`;
  return t.arg === true ? k.label : `${k.label}: ${t.type === "stat" ? measureLabel(String(t.arg)) || String(t.arg) : t.arg}`;
}

/** A tile as a pack writes it, from the tile as the server reads it: only what differs from the defaults. */
export function toInput(t: Tile): Record<string, unknown> {
  const out: Record<string, unknown> = { [t.type]: t.type === "links" ? (t.links ?? []) : t.arg };
  if (t.title) out.title = t.title;
  if (t.width !== (WIDE.has(t.type) ? 2 : 1)) out.width = t.width;
  for (const k of ["test", "tests", "section", "tag", "params", "split", "runs", "of", "unit", "goal", "kind", "limit", "columns", "x", "y", "compare"] as const) {
    const v = t[k];
    if (v === undefined || (Array.isArray(v) && v.length === 0)) continue;
    if (k === "goal" && Object.keys(v).length === 0) continue;
    out[k] = v;
  }
  // `stat: passrate` already names its measure.
  if (t.measure !== undefined && !(t.type === "stat" && t.measure === t.arg)) out.measure = t.measure;
  if (!t.current) out.current = false;
  if (!t.public) out.public = false;
  return out;
}

/** What a save sends (POST /packs/:id/dashboard): the dashboard as a pack's `dashboard:` block writes it. */
export function toSave(d: Dashboard): Record<string, unknown> {
  const out: Record<string, unknown> = d.days ? { days: d.days } : { runs: d.runs };
  if (d.filters.length) out.filters = d.filters;
  const named = d.groups.some((g) => g.title);
  if (!named && d.groups.length <= 1) out.tiles = (d.groups[0]?.tiles ?? []).map(toInput);
  else out.groups = d.groups.map((g) => ({ ...(g.title ? { title: g.title } : {}), tiles: g.tiles.map(toInput) }));
  return out;
}

/** A copy of a tile to edit (plain JSON, so it also copies the reactive tiles of the page). */
export function cloneTile(t: Tile): Tile {
  return JSON.parse(JSON.stringify(t)) as Tile;
}
