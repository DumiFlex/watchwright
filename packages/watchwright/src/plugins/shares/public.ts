import type { DashboardResult, TileResult } from "../dashboards/data.js";
import type { ShareOptions, Tile, TileType } from "../packs/dashboard.js";
import type { ArtifactInfo } from "../../jobs/recorder.js";
import type { ResultDocument } from "../runs/results.js";

// What a pack's dashboard and its runs show to people without an account (docs/plans/dashboards.md,
// sections 5 and 6): only tiles marked public, only kinds that make sense there, and nothing the
// pack's `share:` block keeps out. Files tiles point at are served from the public run's own
// address, so a tile never hands out a file the run's share wouldn't.

/** Kinds the public status page shows; the ones that show what runs made need its runs to open. */
const STATUS_KINDS = new Set<TileType>(["outcome", "metric", "score", "choices", "flags", "duration", "stat", "leaderboard", "scatter", "breakdown", "matrix", "flaky", "value", "latest", "note"]);
const STATUS_MADE = new Set<TileType>(["shot", "output", "failures", "lowest"]);
/** Kinds a shared run shows for that one run: its numbers, not its history. */
const RUN_KINDS = new Set<TileType>(["metric", "score", "choices", "flags", "stat", "leaderboard", "breakdown", "value", "note"]);

export type PublicPlace = { place: "status"; linkRuns: boolean } | { place: "run" };

/** The measures a tile reads, to drop the ones the share block keeps out. */
function measuresOf(t: Tile): string[] {
  const out = [t.measure, t.x, t.y, ...(t.columns ?? [])].filter((m): m is string => !!m);
  if (t.type === "stat" && typeof t.arg === "string") out.push(t.arg);
  if (t.type === "lowest" && typeof t.arg === "string") out.push(t.arg.startsWith("metric.") ? t.arg : `score.${t.arg}`);
  return out;
}

const hidden = (m: string, share: ShareOptions) => (share.metrics === false && m.startsWith("metric.")) || (share.reviews === false && (m === "score" || m.startsWith("score.")));

/** Whether a tile may show in a public place, and the shares' options allow what it reads. */
export function tileAllowed(t: Tile, where: PublicPlace, share: ShareOptions | null): boolean {
  if (!t.public) return false;
  if (where.place === "run" ? !RUN_KINDS.has(t.type) : !(STATUS_KINDS.has(t.type) || (where.linkRuns && STATUS_MADE.has(t.type)))) return false;
  const s = share ?? {};
  if (s.metrics === false && t.type === "metric") return false;
  if (s.reviews === false && ["score", "choices", "unreviewed"].includes(t.type)) return false;
  if (t.type === "output" && (s.texts === false || (typeof t.arg === "string" && s.outputs?.includes(t.arg)))) return false;
  // A leaderboard keeps its other columns; any other tile that reads a hidden measure goes.
  if (t.type === "leaderboard") return true;
  return !measuresOf(t).some((m) => hidden(m, s));
}

/** File items in a tile's data point at the public run's files; one without an address is dropped. */
function rewriteFiles(data: unknown, base: (runId: string) => string | null, share: ShareOptions): unknown {
  if (Array.isArray(data)) return data.map((x) => rewriteFiles(x, base, share));
  if (!data || typeof data !== "object") return data;
  const o = data as Record<string, unknown>;
  if (typeof o.path === "string" && typeof o.runId === "string" && typeof o.url === "string") {
    const b = base(o.runId);
    if (!b || share.outputs?.includes(String(o.name))) return null;
    const { path, ...rest } = o;
    return { ...rest, url: `${b}files/${path.split("/").map(encodeURIComponent).join("/")}` };
  }
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, rewriteFiles(v, base, share)]));
}

/** A dashboard's groups as a public place shows them. Empty groups go. */
export function publicGroups(result: DashboardResult, where: PublicPlace, share: ShareOptions | null, base: (runId: string) => string | null): DashboardResult["groups"] {
  const s = share ?? {};
  return result.groups
    .map((g) => ({
      title: g.title,
      tiles: g.tiles
        .filter((r) => tileAllowed(r.tile, where, share))
        .map((r): TileResult => {
          let data = r.data;
          if (data && r.tile.type === "leaderboard") {
            const cols = (data.columns as { key: string }[]).filter((c) => !hidden(c.key, s));
            data = { ...data, columns: cols };
          }
          return { ...r, data: data ? (rewriteFiles(data, base, s) as Record<string, unknown>) : null };
        }),
    }))
    .filter((g) => g.tiles.length > 0);
}

/** Whether an artifact is one of the outputs the share block keeps out. */
export function keptOut(a: Pick<ArtifactInfo, "kind" | "name">, share: ShareOptions | null): boolean {
  if (!share) return false;
  if (a.kind === "text" && share.texts === false) return true;
  return (a.kind === "text" || a.kind === "file") && (share.outputs ?? []).some((n) => a.name === n || a.name.replace(/\.[^.]+$/, "") === n);
}

/** An attempt as a share shows it, without what the pack's share block keeps out. */
export function shareDocument<T extends Pick<ResultDocument, "texts" | "metrics">>(d: T, share: ShareOptions | null): T {
  if (!share) return d;
  const texts = share.texts === false ? {} : Object.fromEntries(Object.entries(d.texts).filter(([k]) => !(share.outputs ?? []).includes(k)));
  return { ...d, texts, metrics: share.metrics === false ? {} : d.metrics };
}
