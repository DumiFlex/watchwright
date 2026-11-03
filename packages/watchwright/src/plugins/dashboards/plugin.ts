import type Database from "better-sqlite3";
import { ActionError, defineAction } from "../../actions/registry.js";
import { allows, type CallUser } from "../../core/access.js";
import { definePlugin } from "../../core/plugin.js";
import { serviceKey, type Services } from "../../core/services.js";
import { DEFAULT_DASHBOARD, MAX_RUNS, readDashboard, type Dashboard } from "../packs/dashboard.js";
import { PACKS, type PackSummary } from "../packs/registry.js";
import { REVIEWS } from "../reviews/plugin.js";
import { RUNS_REPO } from "../runs/plugin.js";
import { dashboardData, dashboardNames, type DashboardQuery, type DashboardResult } from "./data.js";

// Dashboards (docs/plans/dashboards.md): what a pack's page shows at the top, made of tiles. The
// pack's `dashboard:` block says what it wants; people change it on the page, and that change is
// kept here, one row per pack, until someone resets it to the pack's.

export const DASHBOARDS_SQL = `
  CREATE TABLE dashboards (
    pack_id    TEXT PRIMARY KEY,
    spec       TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

/** Where a pack's dashboard comes from: the change made on the page, the pack's block, or the default. */
export type DashboardSource = "override" | "pack" | "default";

export interface PackDashboard {
  dashboard: Dashboard;
  source: DashboardSource;
  /** The pack has its own `dashboard:` block (so a reset goes back to it, not to the default). */
  packHasOwn: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
}

export class DashboardStore {
  constructor(private readonly db: Database.Database) {}

  override(packId: string): { spec: unknown; updatedBy: string; updatedAt: string } | null {
    const row = this.db.prepare("SELECT spec, updated_by, updated_at FROM dashboards WHERE pack_id = ?").get(packId) as { spec: string; updated_by: string; updated_at: string } | undefined;
    return row ? { spec: JSON.parse(row.spec) as unknown, updatedBy: row.updated_by, updatedAt: row.updated_at } : null;
  }

  save(packId: string, spec: unknown, by: string): void {
    this.db
      .prepare("INSERT INTO dashboards (pack_id, spec, updated_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (pack_id) DO UPDATE SET spec = excluded.spec, updated_by = excluded.updated_by, updated_at = excluded.updated_at")
      .run(packId, JSON.stringify(spec), by, new Date().toISOString());
  }

  remove(packId: string): boolean {
    return this.db.prepare("DELETE FROM dashboards WHERE pack_id = ?").run(packId).changes > 0;
  }

  /** The dashboard a pack shows: the saved change, else the pack's block, else the default. */
  of(pack: PackSummary): PackDashboard {
    const o = this.override(pack.id);
    if (o) {
      // A saved change was checked when saved; if a newer server reads it differently, fall back.
      const d = readDashboard(o.spec, []);
      if (d) return { dashboard: d, source: "override", packHasOwn: pack.dashboard !== null, updatedBy: o.updatedBy, updatedAt: o.updatedAt };
    }
    if (pack.dashboard) return { dashboard: pack.dashboard, source: "pack", packHasOwn: true, updatedBy: null, updatedAt: null };
    return { dashboard: DEFAULT_DASHBOARD, source: "default", packHasOwn: false, updatedBy: null, updatedAt: null };
  }
}

/** Dashboards for other plugins (the status page and shares). */
export interface Dashboards {
  store: DashboardStore;
  /** A pack's dashboard with every tile's data. */
  show(packId: string, q?: DashboardQuery): PackDashboard & DashboardResult;
}

export const DASHBOARDS = serviceKey<Dashboards>("dashboards.service");

const PACK_ID = { type: "string", pattern: "^[0-9a-f]{8}$", description: "Pack id." } as const;

/** `model=q9,format=json` → { model: "q9", format: "json" }. */
export function parseFilter(s: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (s ?? "").split(",")) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

/** What a dashboard shows people without an account: its public tiles, in their groups, and how far back they read. */
export function publicPart(d: Dashboard): string {
  const groups = d.groups.map((g) => ({ title: g.title, tiles: g.tiles.filter((t) => t.public) })).filter((g) => g.tiles.length > 0);
  return JSON.stringify({ runs: d.runs, days: d.days ?? null, groups });
}

/** Only admins change what the public status page and shares show (docs/research/teams-and-audience-dashboards.md). */
function checkPublic(user: CallUser | null | undefined, before: Dashboard, after: Dashboard): void {
  if (allows("admin", user) || publicPart(before) === publicPart(after)) return;
  throw new ActionError(
    "public_tiles_admin_only",
    "Only admins change what the public status page and shares show: the tiles marked public and the runs they read. Keep those as they are, or make your new tiles private.",
    403,
  );
}

function packOf(services: Services, id: string): PackSummary {
  const pack = services.get(PACKS).get(id);
  if (!pack) throw new ActionError("not_found", `No pack with id ${id}.`, 404);
  return pack;
}

export const dashboardsPlugin = definePlugin({
  name: "dashboards",
  migrations: [{ id: 1, name: "init", sql: DASHBOARDS_SQL }],
  setup({ store, services }) {
    const dashboards = new DashboardStore(store.db);
    services.provide(DASHBOARDS, {
      store: dashboards,
      show(packId, q = {}) {
        const pack = packOf(services, packId);
        const d = dashboards.of(pack);
        const reviews = services.has(REVIEWS) ? services.get(REVIEWS) : null;
        return { ...d, ...dashboardData({ runs: services.get(RUNS_REPO), reviews, pack }, d.dashboard, q) };
      },
    });
  },
  actions: ({ services }) => {
    const svc = () => services.get(DASHBOARDS);
    return [
      defineAction<{ id: string; runs?: number; days?: number; filter?: string }>({
        name: "dashboards.get",
        pack: { pack: "id" },
        title: "A pack's dashboard: its tiles (the pack's, or as changed on its page) with each tile's numbers over the latest runs",
        method: "GET",
        path: "/packs/:id/dashboard",
        agent: {
          tool: "pack_dashboard",
          say: "Use it to answer questions about a pack across runs (which setup scores best, what got slower, which tests flip) without reading results one by one. `filter` picks param values such as model=q9.",
        },
        input: {
          type: "object",
          properties: {
            id: PACK_ID,
            runs: { type: "integer", minimum: 1, maximum: MAX_RUNS, description: "How many runs back, instead of the dashboard's." },
            days: { type: "integer", minimum: 1, maximum: 3650, description: "How many days back, instead of a number of runs." },
            filter: { type: "string", maxLength: 500, description: "Only runs with these param (or info) values: name=value, comma-separated." },
          },
          required: ["id"],
        },
        handler: ({ id, runs, days, filter }) => svc().show(id, { runs, days, filters: parseFilter(filter) }),
      }),
      defineAction<{ id: string }>({
        name: "dashboards.names",
        pack: { pack: "id" },
        title: "Names a pack's dashboard can use, found in its latest 50 runs: params, facts, metrics, texts, files, screenshots, flags, criteria, sections, tags and tests",
        method: "GET",
        path: "/packs/:id/dashboard/names",
        input: { type: "object", properties: { id: PACK_ID }, required: ["id"] },
        handler: ({ id }) => {
          const pack = packOf(services, id);
          const reviews = services.has(REVIEWS) ? services.get(REVIEWS) : null;
          return dashboardNames({ runs: services.get(RUNS_REPO), reviews, pack });
        },
      }),
      defineAction<{ id: string; tiles?: unknown[]; groups?: unknown[]; runs?: number; days?: number; filters?: string[] }>({
        name: "dashboards.save",
        pack: { pack: "id" },
        title: "Change what a pack's dashboard shows (kept on the server until reset to the pack's)",
        method: "POST",
        path: "/packs/:id/dashboard",
        input: {
          type: "object",
          properties: {
            id: PACK_ID,
            tiles: { type: "array", maxItems: 60, description: "Tiles, as a pack's `dashboard.tiles` writes them ({ metric: \"Load ms\", width: 2 })." },
            groups: { type: "array", maxItems: 20, description: "Named rows of tiles: [{ title, tiles }], instead of `tiles`." },
            runs: { type: "integer", minimum: 1, maximum: MAX_RUNS },
            days: { type: "integer", minimum: 1, maximum: 3650 },
            filters: { type: "array", items: { type: "string", minLength: 1, maxLength: 80 }, maxItems: 10 },
          },
          required: ["id"],
        },
        handler: ({ id, ...spec }, call) => {
          packOf(services, id);
          const problems: string[] = [];
          const raw = Object.fromEntries(Object.entries(spec).filter(([, v]) => v !== undefined));
          const d = readDashboard(raw, problems);
          if (!d) throw new ActionError("bad_dashboard", problems[0] ?? "The dashboard isn't valid.", 400, { problems });
          checkPublic(call.user, svc().store.of(packOf(services, id)).dashboard, d);
          svc().store.save(id, raw, call.user?.name ?? call.client);
          return svc().store.of(packOf(services, id));
        },
      }),
      defineAction<{ id: string }>({
        name: "dashboards.reset",
        pack: { pack: "id" },
        title: "Drop the changes made to a pack's dashboard on its page: it shows the pack's own again",
        method: "DELETE",
        path: "/packs/:id/dashboard",
        input: { type: "object", properties: { id: PACK_ID }, required: ["id"] },
        handler: ({ id }, call) => {
          const pack = packOf(services, id);
          const before = svc().store.of(pack).dashboard;
          const after = pack.dashboard ?? DEFAULT_DASHBOARD;
          checkPublic(call.user, before, after);
          svc().store.remove(id);
          return svc().store.of(pack);
        },
      }),
    ];
  },
});
