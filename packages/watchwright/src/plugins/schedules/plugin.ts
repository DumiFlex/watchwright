import { ActionError, defineAction, type ActionCall } from "../../actions/registry.js";
import { definePlugin } from "../../core/plugin.js";
import { ACTIONS, SERVER_PORT } from "../../core/keys.js";
import { serviceKey } from "../../core/services.js";
import { ENGINE, FILES_ROOT } from "../runs/plugin.js";
import { ScheduleError, Scheduler, type MissedPolicy, type RunInput, type Schedule, type ScheduleInput } from "./scheduler.js";
import { hostPlace, setStartup, startupInfo, type StartupPlace } from "./startup.js";
import type { When } from "./when.js";

// Schedules: runs that start by themselves, every so often or on a cron expression. A due schedule
// starts its run through the `runs.start` action, as `schedule:<name>`, so runs don't need to know
// about schedules (docs/plans/groundwork.md, section 6).

export const SCHEDULER = serviceKey<Scheduler>("schedules.scheduler");
/** Where start at sign-in writes its file (tests provide their own; default this machine). */
export const STARTUP_PLACE = serviceKey<StartupPlace>("schedules.startup-place");

const GOING = new Set(["queued", "running", "pausing", "paused"]);

const SCHEDULE_ID = { type: "string", pattern: "^[0-9a-f]{8}$" } as const;
const WHEN = {
  type: "object",
  description: "Either `every` (15m, 2h, 1d) or `cron` (minute hour day month weekday) with an optional `timezone` (default the machine's).",
  properties: { every: { type: "string" }, cron: { type: "string" }, timezone: { type: "string" } },
} as const;
const RUN = {
  type: "object",
  description: "What to start: the fields of POST /runs except packId (tests, params, preset, label, attempts, trace, video, signIn, …).",
} as const;
const MISSED = { type: "string", enum: ["once", "skip"], description: "A time missed while the server was off: start once when it's back (default), or skip it." } as const;

interface WhenBody {
  every?: string;
  cron?: string;
  timezone?: string;
}

function whenOf(body: WhenBody): When {
  if ((body.every === undefined) === (body.cron === undefined)) throw new ActionError("bad_when", "Give `when` either `every` or `cron`, not both.");
  if (body.every !== undefined) return { every: body.every };
  return { cron: body.cron!, ...(body.timezone ? { timezone: body.timezone } : {}) };
}

/** Turns scheduler errors into the API's error envelope. */
async function guard<T>(fn: () => T | Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ScheduleError) throw new ActionError(err.code, err.message, err.status);
    throw err;
  }
}

const SYSTEM_CALL = (client: string): ActionCall => ({ client, signal: new AbortController().signal, fromPage: false });

export const schedulesPlugin = definePlugin({
  name: "schedules",
  migrations: [
    {
      id: 1,
      name: "init",
      sql: `CREATE TABLE schedules (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
        pack_id     TEXT NOT NULL,
        when_json   TEXT NOT NULL,
        run_json    TEXT NOT NULL,
        missed      TEXT NOT NULL,
        enabled     INTEGER NOT NULL,
        next_at     TEXT,
        last_due_at TEXT,
        last_run_id TEXT,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );
      CREATE TABLE schedules_runs (
        schedule_id TEXT NOT NULL,
        run_id      TEXT NOT NULL,
        due_at      TEXT NOT NULL,
        started_at  TEXT NOT NULL
      );
      CREATE INDEX schedules_runs_by_schedule ON schedules_runs (schedule_id, started_at);`,
    },
  ],
  pages: [{ name: "schedules", title: "Schedules", path: "/schedules", icon: "CalendarClock", menu: "main", order: 35, words: "cron every timer nightly" }],
  setup({ store, events, services }) {
    services.provide(SCHEDULER, new Scheduler(store.db, events));
  },
  ready({ services }) {
    const engine = services.get(ENGINE);
    services.get(SCHEDULER).begin({
      start: async (s) => {
        const action = services.get(ACTIONS).find((a) => a.name === "runs.start");
        if (!action) throw new Error("Runs aren't loaded.");
        const run = (await action.handler({ ...s.run, packId: s.packId }, SYSTEM_CALL(`schedule:${s.name}`))) as { id: string };
        return run.id;
      },
      going: (runId) => GOING.has(engine.get(runId)?.status ?? ""),
    });
  },
  close({ services }) {
    services.get(SCHEDULER).close();
  },
  actions: ({ services }) => {
    const scheduler = services.get(SCHEDULER);
    const engine = services.get(ENGINE);
    const lastRun = (id: string | null) => {
      const r = id ? engine.get(id) : null;
      return r ? { id: r.id, status: r.status, createdAt: r.createdAt, finishedAt: r.finishedAt, counts: r.counts } : null;
    };
    const withLast = (s: Schedule) => ({ ...s, lastRun: lastRun(s.lastRunId) });
    /** Checks that the pack and run choices start a run, by planning one. */
    const checkRun = async (packId: string, run: RunInput) => {
      const preview = services.get(ACTIONS).find((a) => a.name === "runs.preview");
      if (!preview) return;
      const plan = Object.fromEntries(Object.entries(run).filter(([k]) => k !== "label" && k !== "preset"));
      try {
        await preview.handler({ ...plan, packId }, SYSTEM_CALL("schedules"));
      } catch (err) {
        if (err instanceof ActionError && err.status < 500) throw new ActionError("bad_run", `The schedule's run wouldn't start: ${err.message}`, 400);
        throw err;
      }
    };

    const place = () => (services.has(STARTUP_PLACE) ? services.get(STARTUP_PLACE) : hostPlace());
    const port = () => (services.has(SERVER_PORT) ? services.get(SERVER_PORT) : 0);

    type Body = { name: string; packId: string; when: WhenBody; run?: RunInput; missed?: MissedPolicy; enabled?: boolean };
    return [
      defineAction({
        name: "schedules.list",
        title: "The schedules: name, pack, when (in words too), next time, and the last run with its outcome",
        method: "GET",
        path: "/schedules",
        handler: () => scheduler.list().map(withLast),
      }),
      defineAction<{ id: string }>({
        name: "schedules.get",
        title: "One schedule with its runs, newest first",
        method: "GET",
        path: "/schedules/:id",
        input: { type: "object", properties: { id: SCHEDULE_ID }, required: ["id"] },
        handler: ({ id }) =>
          guard(() => {
            const s = scheduler.get(id);
            return { ...withLast(s), runs: scheduler.runs(id).map((r) => ({ ...r, run: lastRun(r.runId) })) };
          }),
      }),
      defineAction<Body>({
        name: "schedules.create",
        destructive: true,
        explain: ({ name, when }) => `Create the schedule "${name}" (${when.every ? `every ${when.every}` : when.cron}), which starts runs by itself`,
        title: "Create a schedule: a pack's run that starts by itself every so often or on a cron expression",
        method: "POST",
        path: "/schedules",
        status: 201,
        input: {
          type: "object",
          properties: { name: { type: "string", minLength: 1, maxLength: 64 }, packId: { type: "string", pattern: "^[0-9a-f]{8}$" }, when: WHEN, run: RUN, missed: MISSED, enabled: { type: "boolean", default: true } },
          required: ["name", "packId", "when"],
        },
        handler: async (b) => {
          const input: ScheduleInput = { name: b.name, packId: b.packId, when: whenOf(b.when), run: b.run ?? {}, missed: b.missed ?? "once", enabled: b.enabled ?? true };
          await checkRun(input.packId, input.run ?? {});
          return guard(() => withLast(scheduler.create(input)));
        },
      }),
      defineAction<Partial<Body> & { id: string }>({
        name: "schedules.update",
        destructive: true,
        explain: ({ id }) => `Change the schedule ${id}`,
        title: "Change a schedule: any of its name, pack, when, run, missed-time policy or on/off",
        method: "POST",
        path: "/schedules/:id",
        input: {
          type: "object",
          properties: { id: SCHEDULE_ID, name: { type: "string", minLength: 1, maxLength: 64 }, packId: { type: "string", pattern: "^[0-9a-f]{8}$" }, when: WHEN, run: RUN, missed: MISSED, enabled: { type: "boolean" } },
          required: ["id"],
        },
        handler: async ({ id, when, ...rest }) => {
          const old = await guard(() => scheduler.get(id));
          const change: Partial<ScheduleInput> = { ...rest };
          if (when !== undefined) change.when = whenOf(when);
          if (rest.packId !== undefined || rest.run !== undefined) await checkRun(rest.packId ?? old.packId, rest.run ?? old.run);
          return guard(() => withLast(scheduler.update(id, change)));
        },
      }),
      defineAction<{ id: string }>({
        name: "schedules.delete",
        destructive: true,
        explain: ({ id }) => `Delete the schedule ${id}`,
        title: "Delete a schedule (its runs stay)",
        method: "DELETE",
        path: "/schedules/:id",
        input: { type: "object", properties: { id: SCHEDULE_ID }, required: ["id"] },
        handler: ({ id }) =>
          guard(() => {
            scheduler.delete(id);
            return { deleted: id };
          }),
      }),
      defineAction<{ id: string }>({
        name: "schedules.run-now",
        title: "Start a schedule's run now, outside its times",
        method: "POST",
        path: "/schedules/:id/run",
        status: 201,
        input: { type: "object", properties: { id: SCHEDULE_ID }, required: ["id"] },
        handler: async ({ id }) => ({ runId: await guard(() => scheduler.runNow(id)) }),
      }),
      defineAction<{ id: string }>({
        name: "schedules.pause",
        title: "Pause a schedule: it starts nothing until resumed",
        method: "POST",
        path: "/schedules/:id/pause",
        input: { type: "object", properties: { id: SCHEDULE_ID }, required: ["id"] },
        handler: ({ id }) => guard(() => withLast(scheduler.update(id, { enabled: false }))),
      }),
      defineAction<{ id: string }>({
        name: "schedules.resume",
        destructive: true,
        explain: ({ id }) => `Resume the schedule ${id}, which starts runs by itself again`,
        title: "Resume a paused schedule from its next time",
        method: "POST",
        path: "/schedules/:id/resume",
        input: { type: "object", properties: { id: SCHEDULE_ID }, required: ["id"] },
        handler: ({ id }) => guard(() => withLast(scheduler.update(id, { enabled: true }))),
      }),
      defineAction({
        name: "schedules.startup",
        title: "Start at sign-in: whether this server starts when you sign in to the computer (Windows), and the command that starts it",
        method: "GET",
        path: "/startup",
        handler: () => startupInfo(place(), port(), services.get(FILES_ROOT)),
      }),
      defineAction<{ enabled: boolean }>({
        name: "schedules.set-startup",
        destructive: true,
        explain: ({ enabled }) => (enabled ? "Start this Watchwright server when you sign in to the computer" : "Stop starting this Watchwright server when you sign in"),
        title: "Turn start at sign-in on or off (Windows: a file in your Startup folder that starts this server with its port and data folder)",
        method: "POST",
        path: "/startup",
        input: { type: "object", properties: { enabled: { type: "boolean" } }, required: ["enabled"] },
        handler: async ({ enabled }) => {
          try {
            return await setStartup(place(), port(), services.get(FILES_ROOT), enabled);
          } catch (err) {
            throw new ActionError("not_supported", err instanceof Error ? err.message : String(err), 400);
          }
        },
      }),
    ];
  },
});
