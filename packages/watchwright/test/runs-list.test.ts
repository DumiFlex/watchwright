import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RunsRepo, type RunStatus, type RunSummary } from "../src/plugins/runs/repo.js";
import { cleanTempDirs, tempDir } from "./helpers/fixtures.js";
import { engineOf, startHarness, type Harness } from "./helpers/harness.js";

// Listing runs with filters and a cursor, and deleting them. Rows are written straight into the
// store, so these tests need no browser.

const harnesses: Harness[] = [];
afterEach(async () => {
  for (const h of harnesses.splice(0)) await h.close();
  cleanTempDirs();
});

async function withRuns(rows: { id: string; pack: string; status: RunStatus; at: string; label?: string; params?: Record<string, unknown> }[]) {
  const dataDir = tempDir("ww-data-");
  const h = await startHarness(dataDir);
  harnesses.push(h);
  const repo = new RunsRepo(h.app.watchwright.store.db);
  for (const r of rows)
    repo.insertRun({
      id: r.id,
      pack_id: r.pack,
      pack_name: `Pack ${r.pack}`,
      pack_path: "/packs/x",
      site_key: "site",
      job_kind: "test",
      tests: "[]",
      params: JSON.stringify(r.params ?? {}),
      options: "{}",
      label: r.label ?? "",
      status: r.status,
      started_by: "api",
      created_at: r.at,
    });
  return { h, dataDir };
}

const ids = (list: RunSummary[]) => list.map((r) => r.id);

describe("runs list and delete", () => {
  const rows = [
    { id: "00000001", pack: "aaaaaaaa", status: "finished" as const, at: "2026-10-01T10:00:00.000Z" },
    { id: "00000002", pack: "bbbbbbbb", status: "stopped" as const, at: "2026-10-02T10:00:00.000Z" },
    { id: "00000003", pack: "aaaaaaaa", status: "finished" as const, at: "2026-10-03T10:00:00.000Z" },
    { id: "00000004", pack: "aaaaaaaa", status: "queued" as const, at: "2026-10-04T10:00:00.000Z" },
  ];

  it("searches by id, label, pack name, values and status, every word", async () => {
    const { h } = await withRuns([
      { id: "0000000a", pack: "aaaaaaaa", status: "finished", at: "2026-10-01T10:00:00.000Z", label: "nightly", params: { lang: "de", n: 5 } },
      { id: "0000000b", pack: "bbbbbbbb", status: "stopped", at: "2026-10-02T10:00:00.000Z", label: "100% sure", params: { lang: "en", n: 50 } },
    ]);
    const find = async (q: string) => ids((await h.api<RunSummary[]>("GET", `/runs?q=${encodeURIComponent(q)}`)).data);
    expect(await find("NIGHT")).toEqual(["0000000a"]);
    expect(await find("0000000b")).toEqual(["0000000b"]);
    expect(await find("pack bbbb")).toEqual(["0000000b"]);
    expect(await find("lang=de")).toEqual(["0000000a"]);
    expect(await find("n=5")).toEqual(["0000000a"]);
    expect(await find("n=50")).toEqual(["0000000b"]);
    expect(await find("stopped")).toEqual(["0000000b"]);
    expect(await find("nightly stopped")).toEqual([]);
    // % and _ are letters here, not wildcards
    expect(await find("100%")).toEqual(["0000000b"]);
    expect(await find("_")).toEqual([]);
  });

  it("filters by pack and status and pages by cursor", async () => {
    const { h } = await withRuns(rows);
    expect(ids((await h.api<RunSummary[]>("GET", "/runs")).data)).toEqual(["00000004", "00000003", "00000002", "00000001"]);
    expect(ids((await h.api<RunSummary[]>("GET", "/runs?pack=aaaaaaaa")).data)).toEqual(["00000004", "00000003", "00000001"]);
    expect(ids((await h.api<RunSummary[]>("GET", "/runs?status=finished,stopped")).data)).toEqual(["00000003", "00000002", "00000001"]);
    const page1 = (await h.api<RunSummary[]>("GET", "/runs?limit=2")).data;
    expect(ids(page1)).toEqual(["00000004", "00000003"]);
    const page2 = (await h.api<RunSummary[]>("GET", `/runs?limit=2&before=${encodeURIComponent(page1[1]!.createdAt)}`)).data;
    expect(ids(page2)).toEqual(["00000002", "00000001"]);
  });

  it("refuses a malformed status filter", async () => {
    const { h } = await withRuns([]);
    const res = await h.api("GET", "/runs?status=FINISHED;drop");
    expect(res.status).toBe(400);
  });

  it("deletes a finished run with its folder, and refuses a queued one", async () => {
    const { h, dataDir } = await withRuns(rows);
    const folder = path.join(dataDir, "runs", "00000001", "T1", "attempt-1");
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, "result.json"), "{}");

    const res = await h.api<{ id: string; deleted: boolean }>("DELETE", "/runs/00000001");
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ id: "00000001", deleted: true });
    expect(existsSync(path.join(dataDir, "runs", "00000001"))).toBe(false);
    expect((await h.api("GET", "/runs/00000001")).status).toBe(404);
    expect(h.app.watchwright.events.after(0).some((e) => e.type === "run.deleted" && e.runId === "00000001")).toBe(true);

    const queued = await h.api("DELETE", "/runs/00000004");
    expect(queued.status).toBe(409);
    expect((await h.api("DELETE", "/runs/0000000f")).status).toBe(404);
  });

  it("cleans up ended runs no keep rule keeps, never labeled or going ones, with their files and events", async () => {
    const day = 86_400_000;
    const at = (daysAgo: number) => new Date(Date.now() - daysAgo * day).toISOString();
    const { h, dataDir } = await withRuns([
      { id: "000000c1", pack: "aaaaaaaa", status: "finished", at: at(40) },
      { id: "000000c2", pack: "aaaaaaaa", status: "finished", at: at(35), label: "baseline" },
      { id: "000000c3", pack: "aaaaaaaa", status: "interrupted", at: at(31) },
      { id: "000000c4", pack: "aaaaaaaa", status: "finished", at: at(2) },
      { id: "000000c5", pack: "aaaaaaaa", status: "finished", at: at(1) },
      { id: "000000c6", pack: "bbbbbbbb", status: "stopped", at: at(50) },
      { id: "000000c7", pack: "bbbbbbbb", status: "paused", at: at(45) },
    ]);
    mkdirSync(path.join(dataDir, "runs", "000000c1"), { recursive: true });
    writeFileSync(path.join(dataDir, "runs", "000000c1", "result.json"), "{}");
    h.app.watchwright.events.append("run.log", { message: "old" }, { runId: "000000c1" });
    type Plan = { rules: { keepDays: number; keepPerPack: number }; runs: RunSummary[]; bytes: number; unmeasured: number };
    const plan = async () => (await h.api<Plan>("GET", "/storage/cleanup")).data;
    const set = (values: Record<string, number>) => h.api("POST", "/settings", { values });

    // Off by default: nothing goes.
    expect(await plan()).toMatchObject({ rules: { keepDays: 0, keepPerPack: 0 }, runs: [] });

    // Older than 30 days, oldest first; the labeled and the paused run stay.
    await set({ "runs.keepDays": 30 });
    expect(ids((await plan()).runs)).toEqual(["000000c6", "000000c1", "000000c3"]);

    // The last 2 of each pack: with both rules, a run either rule keeps stays.
    await set({ "runs.keepDays": 0, "runs.keepPerPack": 2 });
    expect(ids((await plan()).runs)).toEqual(["000000c1", "000000c3"]);
    await set({ "runs.keepDays": 30, "runs.keepPerPack": 1 });
    expect(ids((await plan()).runs)).toEqual(["000000c6", "000000c1", "000000c3"]);
    await set({ "runs.keepDays": 3, "runs.keepPerPack": 4 });
    expect(ids((await plan()).runs)).toEqual(["000000c1"]);

    h.app.watchwright.store.db.prepare("UPDATE runs SET size_bytes = 2048 WHERE id = '000000c1'").run();
    expect(await plan()).toMatchObject({ bytes: 2048, unmeasured: 0 });
    // Deleting asks for approval unless the web page asks, as here.
    const res = await h.app.inject({ method: "POST", url: "/api/v1/storage/cleanup", headers: { host: h.host, origin: `http://${h.host}` }, payload: {} });
    expect(res.statusCode).toBe(200);
    expect(ids((res.json() as { data: Plan }).data.runs)).toEqual(["000000c1"]);
    expect(existsSync(path.join(dataDir, "runs", "000000c1"))).toBe(false);
    const events = h.app.watchwright.events.after(0);
    expect(events.filter((e) => e.runId === "000000c1").map((e) => e.type)).toEqual(["run.deleted"]);
    expect(events.find((e) => e.type === "runs.cleaned")?.data).toMatchObject({ count: 1, bytes: 2048, rules: { keepDays: 3, keepPerPack: 4 } });
    expect(ids((await h.api<RunSummary[]>("GET", "/runs")).data)).toEqual(["000000c5", "000000c4", "000000c3", "000000c2", "000000c7", "000000c6"]);
    expect((await plan()).runs).toEqual([]);
  });

  it("after a restart, reports the runs the stop interrupted once, and resumes them when asked", async () => {
    const { h } = await withRuns([
      { id: "000000d1", pack: "aaaaaaaa", status: "interrupted", at: "2026-10-01T10:00:00.000Z" },
      { id: "000000d2", pack: "aaaaaaaa", status: "interrupted", at: "2026-10-02T10:00:00.000Z" },
      { id: "000000d3", pack: "aaaaaaaa", status: "finished", at: "2026-10-03T10:00:00.000Z" },
    ]);
    const db = h.app.watchwright.store.db;
    const engine = engineOf(h);
    db.prepare("UPDATE runs SET stopped_by_server = 1 WHERE id IN ('000000d1', '000000d3')").run();
    expect(engine.afterRestart(false)).toEqual({ interrupted: ["000000d1"], resumed: [] });
    expect(h.app.watchwright.events.after(0).find((e) => e.type === "runs.restarted")?.data).toEqual({ interrupted: ["000000d1"], resumed: [] });
    // Each run once: a later start doesn't report it again.
    expect(engine.afterRestart(true)).toEqual({ interrupted: [], resumed: [] });
    expect((await h.api<RunSummary>("GET", "/runs/000000d1")).data.status).toBe("interrupted");

    db.prepare("UPDATE runs SET stopped_by_server = 1 WHERE id = '000000d2'").run();
    expect(engine.afterRestart(true)).toEqual({ interrupted: ["000000d2"], resumed: ["000000d2"] });
    const log = h.app.watchwright.events.after(0).filter((e) => e.runId === "000000d2").map((e) => e.type);
    expect(log).toContain("run.queued");
    expect(log).toContain("run.log");
  });
});
