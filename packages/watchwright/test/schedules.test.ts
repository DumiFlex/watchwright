import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EventLog } from "../src/events/log.js";
import { corePlugin } from "../src/core/core-plugin.js";
import { migrationsOf } from "../src/core/plugin.js";
import { schedulesPlugin } from "../src/plugins/schedules/plugin.js";
import { Scheduler, type RunStarter } from "../src/plugins/schedules/scheduler.js";
import { setStartup, startupInfo, startupScript, type StartupPlace } from "../src/plugins/schedules/startup.js";
import { checkWhen, describeWhen, nextDue } from "../src/plugins/schedules/when.js";
import { openStore } from "../src/store/db.js";
import type { RunDetail } from "../src/plugins/runs/engine.js";
import { cleanTempDirs, startSite, tempDir, writeFiles } from "./helpers/fixtures.js";
import { engineOf, hasChromium, requireBrowsers, startHarness, type Harness } from "./helpers/harness.js";

// Schedules: when they're due, the timer that starts their runs, skipped and missed times, and
// the API.

const T0 = new Date("2026-10-28T10:00:00.000Z");
const MIN = 60_000;

function world(start = T0) {
  const store = openStore(":memory:", migrationsOf([corePlugin, schedulesPlugin]));
  const events = new EventLog(store.db);
  const clock = { now: new Date(start) };
  const scheduler = new Scheduler(store.db, events, () => clock.now);
  const started: { schedule: string; at: string }[] = [];
  const going = new Set<string>();
  let n = 0;
  let fail: string | null = null;
  const starter: RunStarter = {
    start: async (s) => {
      if (fail) throw new Error(fail);
      started.push({ schedule: s.name, at: clock.now.toISOString() });
      const id = `run${++n}`;
      going.add(id);
      return id;
    },
    going: (id) => going.has(id),
  };
  const types = () => events.after(0).map((e) => e.type);
  return {
    store,
    events,
    scheduler,
    clock,
    started,
    going,
    starter,
    types,
    failWith: (m: string | null) => (fail = m),
    at: (ms: number) => (clock.now = new Date(start.getTime() + ms)),
  };
}

const worlds: ReturnType<typeof world>[] = [];
const harnesses: Harness[] = [];
afterEach(async () => {
  for (const w of worlds.splice(0)) {
    w.scheduler.close();
    w.store.close();
  }
  for (const h of harnesses.splice(0)) await h.close();
  cleanTempDirs();
}, 30_000);
function make(start = T0) {
  const w = world(start);
  worlds.push(w);
  return w;
}

describe("when", () => {
  it("reads gaps and cron expressions, and refuses the rest", () => {
    expect(() => checkWhen({ every: "15m" })).not.toThrow();
    expect(() => checkWhen({ every: "2 h" })).not.toThrow();
    expect(() => checkWhen({ every: "15" })).toThrow(/15m, 2h, 1d/);
    expect(() => checkWhen({ every: "0m" })).toThrow(/once a minute/);
    expect(() => checkWhen({ cron: "0 9 * * 1-5", timezone: "Europe/London" })).not.toThrow();
    expect(() => checkWhen({ cron: "nope" })).toThrow(/cron expression/);
    expect(() => checkWhen({ cron: "0 9 * * *", timezone: "Mars/Olympus" })).toThrow(/time zone/);
  });

  it("counts every-gaps from the anchor and cron times in the zone", () => {
    expect(nextDue({ every: "15m" }, T0, T0)?.toISOString()).toBe("2026-10-28T10:15:00.000Z");
    // A late tick (10:40) after a due time at 10:15 goes to 10:45, not 10:55.
    expect(nextDue({ every: "15m" }, new Date(T0.getTime() + 40 * MIN), new Date(T0.getTime() + 15 * MIN))!.toISOString()).toBe("2026-10-28T10:45:00.000Z");
    // 09:00 in New York is 13:00 UTC on 28 Oct (still daylight time).
    expect(nextDue({ cron: "0 9 * * *", timezone: "America/New_York" }, T0, T0)!.toISOString()).toBe("2026-10-28T13:00:00.000Z");
  });

  it("says when in words", () => {
    expect(describeWhen({ every: "1h" })).toBe("Every hour");
    expect(describeWhen({ every: "15m" })).toBe("Every 15 minutes");
    expect(describeWhen({ cron: "0 9 * * 1-5", timezone: "Europe/London" })).toBe("Weekdays at 09:00 (Europe/London)");
    expect(describeWhen({ cron: "30 2 * * *", timezone: "UTC" })).toBe("Every day at 02:30 (UTC)");
    expect(describeWhen({ cron: "0 */2 * * *", timezone: "UTC" })).toBe("Cron 0 */2 * * * (UTC)");
  });
});

describe("Scheduler", () => {
  it("starts a schedule's run when it's due, and not before", async () => {
    const w = make();
    w.scheduler.begin(w.starter);
    const s = w.scheduler.create({ name: "Nightly", packId: "abcd1234", when: { every: "15m" } });
    expect(s).toMatchObject({ nextAt: "2026-10-28T10:15:00.000Z", says: "Every 15 minutes", missed: "once", enabled: true });
    w.at(14 * MIN);
    await w.scheduler.tick();
    expect(w.started).toEqual([]);
    w.at(15 * MIN);
    await w.scheduler.tick();
    expect(w.started).toEqual([{ schedule: "Nightly", at: "2026-10-28T10:15:00.000Z" }]);
    expect(w.scheduler.get(s.id)).toMatchObject({ lastRunId: "run1", lastDueAt: "2026-10-28T10:15:00.000Z", nextAt: "2026-10-28T10:30:00.000Z" });
    expect(w.scheduler.runs(s.id)).toEqual([{ runId: "run1", dueAt: "2026-10-28T10:15:00.000Z", startedAt: "2026-10-28T10:15:00.000Z" }]);
    expect(w.types()).toContain("schedule.fired");
  });

  it("skips a time while its last run is still going, so runs never pile up", async () => {
    const w = make();
    w.scheduler.begin(w.starter);
    const s = w.scheduler.create({ name: "Often", packId: "abcd1234", when: { every: "1m" } });
    w.at(MIN);
    await w.scheduler.tick();
    w.at(2 * MIN);
    await w.scheduler.tick();
    expect(w.started).toHaveLength(1);
    expect(w.types()).toContain("schedule.skipped");
    w.going.clear();
    w.at(3 * MIN);
    await w.scheduler.tick();
    expect(w.started).toHaveLength(2);
    expect(w.scheduler.get(s.id).nextAt).toBe("2026-10-28T10:04:00.000Z");
  });

  it("starts a missed time once when the server comes back, or skips it", async () => {
    const w = make();
    const once = w.scheduler.create({ name: "Once", packId: "abcd1234", when: { every: "1h" } });
    const skip = w.scheduler.create({ name: "Skip", packId: "abcd1234", when: { every: "1h" }, missed: "skip" });
    // The server was off from 10:00 to 13:30: three times of each were missed.
    w.at(210 * MIN);
    w.scheduler.begin(w.starter);
    await new Promise((r) => setTimeout(r, 10));
    expect(w.started).toEqual([{ schedule: "Once", at: "2026-10-28T13:30:00.000Z" }]);
    expect(w.events.after(0).filter((e) => e.type === "schedule.missed").map((e) => e.data)).toEqual([
      expect.objectContaining({ name: "Once", missedAt: "2026-10-28T11:00:00.000Z", policy: "once" }),
      expect.objectContaining({ name: "Skip", missedAt: "2026-10-28T11:00:00.000Z", policy: "skip" }),
    ]);
    expect(w.scheduler.get(once.id).nextAt).toBe("2026-10-28T14:00:00.000Z");
    expect(w.scheduler.get(skip.id).nextAt).toBe("2026-10-28T14:00:00.000Z");
  });

  it("pauses, resumes from the next time, runs now and records a start that failed", async () => {
    const w = make();
    w.scheduler.begin(w.starter);
    const s = w.scheduler.create({ name: "Daily", packId: "abcd1234", when: { cron: "0 12 * * *", timezone: "UTC" } });
    expect(w.scheduler.update(s.id, { enabled: false }).nextAt).toBeNull();
    w.at(150 * MIN);
    expect(w.scheduler.update(s.id, { enabled: true }).nextAt).toBe("2026-10-29T12:00:00.000Z");
    expect(await w.scheduler.runNow(s.id)).toBe("run1");
    expect(w.scheduler.get(s.id)).toMatchObject({ lastRunId: "run1", lastDueAt: null, nextAt: "2026-10-29T12:00:00.000Z" });
    w.failWith("The pack doesn't load.");
    await expect(w.scheduler.runNow(s.id)).rejects.toThrow(/doesn't load/);
    expect(w.events.after(0).find((e) => e.type === "schedule.failed")?.data).toMatchObject({ message: "The pack doesn't load." });
  });

  it("refuses a taken name, a bad name and a bad time", () => {
    const w = make();
    w.scheduler.create({ name: "Nightly", packId: "abcd1234", when: { every: "1d" } });
    expect(() => w.scheduler.create({ name: "nightly", packId: "abcd1234", when: { every: "1d" } })).toThrow(/already a schedule/);
    expect(() => w.scheduler.create({ name: "", packId: "abcd1234", when: { every: "1d" } })).toThrow(/name/);
    expect(() => w.scheduler.create({ name: "Bad", packId: "abcd1234", when: { cron: "61 * * * *" } })).toThrow(/cron/);
  });
});

describe("schedules through the API", () => {
  async function harness(): Promise<Harness> {
    const h = await startHarness(tempDir("ww-data-"));
    harnesses.push(h);
    return h;
  }

  it("creates, lists, changes and deletes, checking the run would start", async () => {
    const h = await harness();
    const dir = tempDir("ww-pack-");
    writeFiles(dir, {
      "pack.yaml": "name: Sched\nsite: { key: sched, baseURL: \"http://127.0.0.1:9/\" }\n",
      "tests/a.yaml": "tests:\n  - id: A\n    steps:\n      - reload\n",
    });
    const pack = await h.api<{ id: string }>("POST", "/packs", { path: dir });
    // From the web page, as a person would: these actions wait for approval from anywhere else.
    const page = async <T>(method: "POST" | "GET", url: string, payload?: object) => {
      const res = await h.app.inject({ method, url: `/api/v1${url}`, headers: { host: h.host, origin: `http://${h.host}` }, ...(payload ? { payload } : {}) });
      const json = res.json() as { data: T };
      return { status: res.statusCode, data: json.data, body: res.body };
    };
    const bad = await page("POST", "/schedules", { name: "Bad", packId: pack.data.id, when: { every: "1h" }, run: { tests: ["NOPE"] } });
    expect(bad.status).toBe(400);
    expect(bad.body).toMatch(/bad_run/);
    expect((await page("POST", "/schedules", { name: "Both", packId: pack.data.id, when: { every: "1h", cron: "0 * * * *" } })).status).toBe(400);

    const made = await page<{ id: string; says: string; nextAt: string; lastRun: null }>("POST", "/schedules", { name: "Hourly", packId: pack.data.id, when: { every: "1h" }, run: { tests: ["A"] } });
    expect(made.status).toBe(201);
    expect(made.data).toMatchObject({ says: "Every hour", lastRun: null });
    const list = await h.api<{ name: string }[]>("GET", "/schedules");
    expect(list.data.map((s) => s.name)).toEqual(["Hourly"]);
    const paused = await h.api<{ enabled: boolean; nextAt: string | null }>("POST", `/schedules/${made.data.id}/pause`);
    expect(paused.data).toMatchObject({ enabled: false, nextAt: null });
    const changed = await page<{ says: string }>("POST", `/schedules/${made.data.id}`, { when: { cron: "30 6 * * *", timezone: "UTC" }, enabled: true });
    expect(changed.data.says).toBe("Every day at 06:30 (UTC)");
    const one = await h.api<{ runs: unknown[] }>("GET", `/schedules/${made.data.id}`);
    expect(one.data.runs).toEqual([]);
    expect((await h.api("DELETE", `/schedules/${made.data.id}`)).status).toBe(200);
    expect((await h.api("GET", `/schedules/${made.data.id}`)).status).toBe(404);
  });

  it("asks agents before creating, changing, resuming or deleting", async () => {
    const h = await harness();
    const actions = await h.api<{ name: string; destructive?: boolean }[]>("GET", "/actions");
    const destructive = actions.data.filter((a) => a.name.startsWith("schedules.") && a.destructive).map((a) => a.name);
    expect(destructive.sort()).toEqual(["schedules.create", "schedules.delete", "schedules.resume", "schedules.set-startup", "schedules.update"]);
  });
});

describe("start at sign-in", () => {
  const place = (platform: NodeJS.Platform, appData?: string): StartupPlace => ({ platform, appData, node: "C:\\Program Files\\nodejs\\node.exe", script: "C:\\ww\\dist\\cli\\main.js" });

  it("writes a .cmd file to the Startup folder on Windows, and deletes it when turned off", async () => {
    const appData = tempDir("ww-appdata-");
    const p = place("win32", appData);
    const data = "C:\\Users\\me\\100% data";
    expect(startupInfo(p, 7420, data)).toMatchObject({ supported: true, enabled: false });
    const on = await setStartup(p, 7420, data, true);
    expect(on.enabled).toBe(true);
    expect(on.file).toBe(path.join(appData, "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "Watchwright.cmd"));
    const text = readFileSync(on.file!, "utf8");
    expect(text).toContain('start "Watchwright" /min "C:\\Program Files\\nodejs\\node.exe" C:\\ww\\dist\\cli\\main.js serve --port 7420 --data "C:\\Users\\me\\100%% data" --no-open');
    expect(text).toBe(startupScript(p, 7420, data));
    expect(text).toContain("\r\n");
    const off = await setStartup(p, 7420, data, false);
    expect(off.enabled).toBe(false);
    expect(existsSync(on.file!)).toBe(false);
  });

  it("only gives the command elsewhere", async () => {
    const p = place("linux");
    expect(startupInfo(p, 7421, "/data")).toMatchObject({ supported: false, enabled: false, file: null });
    expect(startupInfo(p, 7421, "/data").command).toMatch(/serve --port 7421 --data \/data --no-open$/);
    await expect(setStartup(p, 7421, "/data", true)).rejects.toThrow(/only built in on Windows/);
  });

  // Starting a whole server can take longer than the default 5 s on a busy Windows runner.
  it("answers through the API with this server's port and data folder", { timeout: 30_000 }, async () => {
    const h = await startHarness(tempDir("ww-data-"));
    harnesses.push(h);
    const info = await h.api<{ command: string }>("GET", "/startup");
    expect(info.data.command).toContain(`serve --port ${h.host.split(":")[1]} --data`);
  });
});

const engine = hasChromium || requireBrowsers ? describe : describe.skip;

engine("schedules start real runs", { timeout: 90_000 }, () => {
  it("starts the run through runs.start as schedule:<name>, with the schedule's choices", async () => {
    const site = await startSite();
    try {
      const h = await startHarness(tempDir("ww-data-"));
      harnesses.push(h);
      const dir = tempDir("ww-pack-");
      writeFiles(dir, {
        "pack.yaml": `name: Sched\nsite: { key: sched-${Math.random().toString(36).slice(2, 8)}, baseURL: "${site.url}" }\nrun: { video: false }\n`,
        "tests/a.yaml": "tests:\n  - id: A\n    steps:\n      - goto: /\n  - id: B\n    steps:\n      - goto: /other\n",
      });
      const pack = await h.api<{ id: string }>("POST", "/packs", { path: dir });
      const headers = { host: h.host, origin: `http://${h.host}` };
      const made = (await h.app.inject({ method: "POST", url: "/api/v1/schedules", headers, payload: { name: "Smoke", packId: pack.data.id, when: { every: "1d" }, run: { tests: ["B"], label: "smoke" } } })).json() as { data: { id: string } };
      const now = (await h.app.inject({ method: "POST", url: `/api/v1/schedules/${made.data.id}/run`, headers })).json() as { data: { runId: string } };
      const runId = now.data.runId;
      await h.waitFor((e) => e.runId === runId && e.type === "run.finished", 45_000);
      await engineOf(h).settled(runId);
      const run = (await h.api<RunDetail>("GET", `/runs/${runId}`)).data;
      expect(run).toMatchObject({ startedBy: "schedule:Smoke", label: "smoke" });
      expect(run.attempts.map((a) => [a.testId, a.status])).toEqual([["B", "passed"]]);
      const one = await h.api<{ lastRun: { id: string; status: string }; runs: { runId: string }[] }>("GET", `/schedules/${made.data.id}`);
      expect(one.data.lastRun).toMatchObject({ id: runId, status: "finished" });
      expect(one.data.runs.map((r) => r.runId)).toEqual([runId]);
    } finally {
      await site.close();
    }
  });
});
