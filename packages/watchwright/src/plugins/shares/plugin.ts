import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ActionError, defineAction } from "../../actions/registry.js";
import { definePlugin } from "../../core/plugin.js";
import { serviceKey } from "../../core/services.js";
import { contentTypeOf } from "../../jobs/recorder.js";
import { errorBody } from "../../server/errors.js";
import { PACKS } from "../packs/registry.js";
import type { RunDetail } from "../runs/engine.js";
import { byteRange, ENGINE, FILES_ROOT } from "../runs/plugin.js";
import type { ResultDocument } from "../runs/results.js";
import { DEFAULT_DASHBOARD, SHARES_SQL, SHARES_TOKEN_SQL, SharesStore, type DashboardSettings } from "./store.js";

// Sharing without an account (docs/plans/self-hosting.md, section 4): a share link opens one run's
// results, screenshots, video and files read-only, for anyone with the link; the public dashboard
// shows the latest runs of packs an admin picks. The public routes answer only that run's data and
// the files its attempts recorded, never anything else on the server.

export const SHARES = serviceKey<SharesStore>("shares.store");

const RUN_ID = { type: "string", pattern: "^[0-9a-f]{8}$", description: "Run id." } as const;
const ID = { type: "string", pattern: "^[0-9a-f]{12}$" } as const;

/** Artifact kinds a share leaves out unless it includes traces: they can hold cookies and tokens a site set. */
const PRIVATE_KINDS = new Set(["trace", "collector"]);
const isPrivate = (a: { kind: string; path: string }) => PRIVATE_KINDS.has(a.kind) || a.path.includes("/collectors/");

/** Requests one address may make to the public routes in a minute (a video plays in many range requests). */
const PER_MINUTE = 600;

/** What a public request may see: a run, and whether its traces come along. */
interface Opened {
  runId: string;
  traces: boolean;
  /** Where its files are served from, ending in `/`. */
  base: string;
}

export const sharesPlugin = definePlugin({
  name: "shares",
  migrations: [
    { id: 1, name: "init", sql: SHARES_SQL },
    { id: 2, name: "token", sql: SHARES_TOKEN_SQL },
  ],
  setup({ store, services }) {
    services.provide(SHARES, new SharesStore(store.db));
  },
  ready({ services }) {
    const engine = services.get(ENGINE);
    services.get(SHARES).sweep((id) => engine.get(id) !== null);
  },
  actions: ({ services }) => {
    const shares = () => services.get(SHARES);
    const dashboard = () => ({ ...DEFAULT_DASHBOARD, ...shares().config<DashboardSettings>("dashboard") });
    return [
      defineAction<{ run?: string }>({
        name: "shares.list",
        title: "Share links that still work, of one run or all",
        method: "GET",
        path: "/shares",
        access: "user",
        input: { type: "object", properties: { run: RUN_ID } },
        handler: ({ run }) => {
          const engine = services.get(ENGINE);
          return shares()
            .list(run)
            .map((s) => {
              const r = engine.get(s.runId);
              return { ...s, run: r ? { packName: r.packName, label: r.label, status: r.status, createdAt: r.createdAt } : null };
            });
        },
      }),
      defineAction<{ run: string; days?: number; traces?: boolean }>({
        name: "shares.add",
        title: "Make a link that lets anyone who has it see a run's results, screenshots, video and files, read-only",
        method: "POST",
        path: "/shares",
        status: 201,
        access: "user",
        input: {
          type: "object",
          properties: {
            run: RUN_ID,
            days: { type: "integer", minimum: 1, maximum: 365, description: "The link stops working after this many days; none: it works until removed." },
            traces: { type: "boolean", default: false, description: "Share traces and collector files too. They can hold cookies and tokens the site set." },
          },
          required: ["run"],
        },
        handler: ({ run, days, traces }, call) => {
          if (!services.get(ENGINE).get(run)) throw new ActionError("not_found", `No run ${run}.`, 404);
          const { token, info } = shares().add(run, { days, traces, by: call.user?.name ?? call.client });
          return { ...info, token };
        },
      }),
      defineAction<{ id: string }>({
        name: "shares.remove",
        title: "Take back a share link: it stops working at once",
        method: "DELETE",
        path: "/shares/:id",
        access: "user",
        input: { type: "object", properties: { id: ID }, required: ["id"] },
        handler: ({ id }) => {
          if (!shares().remove(id)) throw new ActionError("not_found", `No share link ${id}.`, 404);
          return { removed: id };
        },
      }),
      defineAction({
        name: "shares.dashboard",
        title: "The public dashboard's settings: whether it is on, its packs, whether its runs open",
        method: "GET",
        path: "/shares/dashboard",
        access: "admin",
        handler: () => dashboard(),
      }),
      defineAction<Partial<DashboardSettings>>({
        name: "shares.set-dashboard",
        title: "Change the public dashboard: on or off, which packs, whether its runs open read-only",
        method: "POST",
        path: "/shares/dashboard",
        access: "admin",
        input: {
          type: "object",
          properties: {
            on: { type: "boolean" },
            packs: { type: "array", items: { type: "string", pattern: "^[0-9a-f]{8}$" }, maxItems: 50 },
            linkRuns: { type: "boolean" },
            title: { type: "string", maxLength: 80 },
          },
        },
        handler: (input) => {
          const next = { ...dashboard(), ...input };
          next.title = next.title.trim();
          shares().setConfig("dashboard", next);
          return next;
        },
      }),
    ];
  },
  routes(app, { services }) {
    const shares = services.get(SHARES);
    const engine = services.get(ENGINE);
    const dataDir = services.get(FILES_ROOT);
    const dashboard = () => ({ ...DEFAULT_DASHBOARD, ...shares.config<DashboardSettings>("dashboard") });

    // A small limit per address, so a leaked link can't be used to hammer the server.
    const hits = new Map<string, { n: number; at: number }>();
    const limited = (req: FastifyRequest, reply: FastifyReply): boolean => {
      const now = Date.now();
      const h = hits.get(req.ip);
      if (!h || now - h.at > 60_000) {
        if (hits.size > 10_000) hits.clear();
        hits.set(req.ip, { n: 1, at: now });
        return false;
      }
      h.n++;
      if (h.n <= PER_MINUTE) return false;
      void reply.code(429).header("retry-after", Math.ceil((h.at + 60_000 - now) / 1000)).send(errorBody("too_many_requests", "Too many requests. Try again in a minute."));
      return true;
    };
    const gone = (reply: FastifyReply) => reply.code(404).send(errorBody("not_shared", "This link doesn't work any more: it was taken back, it expired, or its run was deleted."));

    /** The run a share token opens. */
    const byToken = (token: string, view = false): Opened | null => {
      const s = shares.open(token, view);
      return s ? { runId: s.runId, traces: s.traces, base: `/api/v1/shared/${token}/` } : null;
    };
    /** A run on the public dashboard, when its runs open. */
    const byDashboard = (runId: string): Opened | null => {
      const d = dashboard();
      if (!d.on || !d.linkRuns) return null;
      const r = engine.get(runId);
      return r && d.packs.includes(r.packId) ? { runId, traces: false, base: `/api/v1/public/runs/${runId}/` } : null;
    };

    const fileUrl = (o: Opened, rel: string) => `${o.base}files/${rel.split("/").map(encodeURIComponent).join("/")}`;
    /** The run as a share shows it: no live view or settings, files from the share's own address. */
    const runOut = (o: Opened, r: RunDetail) => ({
      id: r.id,
      packName: r.packName,
      label: r.label,
      status: r.status,
      startedBy: r.startedBy,
      createdAt: r.createdAt,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      error: r.error,
      params: r.params,
      info: r.info,
      counts: r.counts,
      plan: r.plan,
      attempts: r.attempts,
      running: r.live !== null,
      runVideos: r.runVideos.map((v) => ({ size: v.size, url: fileUrl(o, v.path) })),
      traces: o.traces,
    });
    const attemptOut = (o: Opened, d: ResultDocument) => ({ ...d, artifacts: d.artifacts.filter((a) => o.traces || !isPrivate(a)).map((a) => ({ ...a, url: fileUrl(o, a.path) })) });
    /** Files the run's attempts recorded that this share may hand out. */
    const allowed = (o: Opened, r: RunDetail): Set<string> => {
      const ok = new Set(r.runVideos.map((v) => v.path));
      for (const a of r.attempts) for (const f of engine.result(r.id, a.id)?.artifacts ?? []) if (o.traces || !isPrivate(f)) ok.add(f.path);
      return ok;
    };

    const routesFor = (prefix: string, open: (key: string, view: boolean) => Opened | null) => {
      app.get<{ Params: { key: string } }>(`${prefix}`, { config: { access: "public" } }, async (req, reply) => {
        if (limited(req, reply)) return reply;
        const o = open(req.params.key, true);
        const r = o ? engine.get(o.runId) : null;
        if (!o || !r) return gone(reply);
        return { data: runOut(o, r) };
      });
      app.get<{ Params: { key: string; attemptId: string } }>(`${prefix}/attempts/:attemptId`, { config: { access: "public" } }, async (req, reply) => {
        if (limited(req, reply)) return reply;
        const o = open(req.params.key, false);
        const d = o ? engine.result(o.runId, req.params.attemptId) : null;
        if (!o || !d) return gone(reply);
        return { data: attemptOut(o, d) };
      });
      app.get<{ Params: { key: string; "*": string } }>(`${prefix}/files/*`, { config: { access: "public" } }, async (req, reply) => {
        if (limited(req, reply)) return reply;
        const o = open(req.params.key, false);
        const r = o ? engine.get(o.runId) : null;
        const rel = req.params["*"] ?? "";
        if (!o || !r || !allowed(o, r).has(rel)) return reply.code(404).send(errorBody("not_found", "No such file."));
        const abs = path.resolve(dataDir, ...rel.split("/"));
        if (!existsSync(abs) || !statSync(abs).isFile()) return reply.code(404).send(errorBody("not_found", "No such file."));
        const size = statSync(abs).size;
        reply.type(contentTypeOf(abs)).header("cache-control", "private, max-age=300").header("accept-ranges", "bytes");
        const range = byteRange(req.headers.range, size);
        if (range === "bad") return reply.code(416).header("content-range", `bytes */${size}`).send();
        if (!range) return reply.header("content-length", size).send(createReadStream(abs));
        const [start, end] = range;
        return reply
          .code(206)
          .header("content-range", `bytes ${start}-${end}/${size}`)
          .header("content-length", end - start + 1)
          .send(createReadStream(abs, { start, end }));
      });
    };
    routesFor("/shared/:key", (token, view) => byToken(token, view));
    routesFor("/public/runs/:key", (runId) => byDashboard(runId));

    // The public dashboard: each chosen pack's latest run and the trend of its last 20.
    app.get("/public/status", { config: { access: "public" } }, async (req, reply) => {
      if (limited(req, reply)) return reply;
      const d = dashboard();
      if (!d.on) return reply.code(404).send(errorBody("dashboard_off", "This server has no public dashboard."));
      const packs = services.get(PACKS);
      const items = d.packs.flatMap((id) => {
        const pack = packs.get(id);
        if (!pack) return [];
        const runs = engine.list({ packId: id, limit: 20 });
        return [
          {
            packId: id,
            name: pack.name,
            runs: runs.map((r) => ({
              id: r.id,
              label: r.label,
              status: r.status,
              counts: r.counts,
              startedAt: r.startedAt,
              finishedAt: r.finishedAt,
              durationMs: r.startedAt && r.finishedAt ? Date.parse(r.finishedAt) - Date.parse(r.startedAt) : null,
            })),
          },
        ];
      });
      return { data: { title: d.title || "Status", linkRuns: d.linkRuns, packs: items } };
    });
  },
});
