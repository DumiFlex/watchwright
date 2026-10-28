import { afterEach, describe, expect, it } from "vitest";
import { RunsRepo, type AttemptStatus } from "../src/plugins/runs/repo.js";
import { dayList, dayOf, dayStart, runStats, type RunStats } from "../src/plugins/runs/stats.js";
import { cleanTempDirs, tempDir } from "./helpers/fixtures.js";
import { startHarness, type Harness } from "./helpers/harness.js";

// Runs at a glance: per-day counts for the runs page. Rows are written straight into the store.

const harnesses: Harness[] = [];
afterEach(async () => {
  for (const h of harnesses.splice(0)) await h.close();
  cleanTempDirs();
});

describe("days", () => {
  it("reads an instant as the caller's calendar day", () => {
    // 23:30 UTC is already the next day in Berlin (offset -60) and still that day in New York (+300)
    expect(dayOf("2026-10-14T23:30:00.000Z", -60)).toBe("2026-10-15");
    expect(dayOf("2026-10-14T23:30:00.000Z", 300)).toBe("2026-10-14");
    expect(dayStart("2026-10-15", -60)).toBe("2026-10-14T23:00:00.000Z");
  });
  it("lists the days ending with the last one, across a month end", () => {
    expect(dayList("2026-11-02", 4)).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
  });
});

describe("runStats", () => {
  const at = (day: string, t = "10:00:00") => `2026-10-${day}T${t}.000Z`;
  const attempt = (day: string, status: string, seconds = 2) => ({ status, started_at: at(day), finished_at: at(day, `10:00:0${seconds}`) });

  it("counts runs and outcomes per day, and the period before", () => {
    const s = runStats(
      {
        runs: [{ created_at: at("12") }, { created_at: at("14") }, { created_at: at("14") }, { created_at: at("01") }],
        attempts: [
          attempt("14", "passed", 2),
          attempt("14", "failed", 4),
          attempt("14", "broken", 9),
          attempt("13", "passed", 3),
          attempt("13", "running"),
          attempt("12", "passed", 6),
          attempt("11", "skipped"),
          attempt("01", "passed"),
        ],
      },
      { until: "2026-10-14", days: 2, offset: 0 },
    );
    expect(s.days.map((d) => d.date)).toEqual(["2026-10-13", "2026-10-14"]);
    expect(s.days[1]).toMatchObject({ runs: 2, passed: 1, failed: 1, broken: 1, medianMs: 3000 });
    expect(s.days[0]).toMatchObject({ runs: 0, passed: 1, failed: 0, medianMs: 3000 });
    expect(s.current).toMatchObject({ runs: 2, passed: 2, failed: 1, broken: 1, skipped: 0, medianMs: 3000 });
    // the 11th and 12th; the 1st is outside both periods
    expect(s.previous).toMatchObject({ runs: 1, passed: 1, skipped: 1, medianMs: 6000 });
  });

  it("gives empty days and a null median when nothing ran", () => {
    const s = runStats({ runs: [], attempts: [] }, { until: "2026-10-14", days: 3, offset: 0 });
    expect(s.days).toHaveLength(3);
    expect(s.current).toEqual({ runs: 0, passed: 0, failed: 0, broken: 0, skipped: 0, stopped: 0, medianMs: null });
  });
});

describe("GET /runs/stats", () => {
  it("counts a pack's top-level attempts by the caller's day", async () => {
    const h = await startHarness(tempDir("ww-data-"));
    harnesses.push(h);
    const repo = new RunsRepo(h.app.watchwright.store.db);
    let n = 0;
    const run = (id: string, pack: string, created: string) =>
      repo.insertRun({ id, pack_id: pack, pack_name: "Shop", pack_path: "/x", site_key: "s", job_kind: "test", tests: "[]", params: "{}", options: "{}", status: "finished", started_by: "api", created_at: created });
    const attempt = (runId: string, started: string, status: AttemptStatus, parentId: string | null = null) => {
      const id = (++n).toString(16).padStart(12, "0");
      repo.insertAttempt({ id, runId, kind: "test", itemId: `T${n}`, title: "t", number: 1, of: 1, parentId, folder: () => "" });
      repo.finishAttempt(id, { status, flags: [], metrics: {}, notes: [], texts: {}, log: [], error: null });
      repo.db.prepare("UPDATE runs_attempts SET started_at = ?, finished_at = ? WHERE id = ?").run(started, new Date(Date.parse(started) + 1500).toISOString(), id);
      return id;
    };
    run("00000001", "aaaaaaaa", "2026-10-14T23:30:00.000Z");
    const parent = attempt("00000001", "2026-10-14T23:30:00.000Z", "passed");
    attempt("00000001", "2026-10-14T23:31:00.000Z", "failed", parent); // a child: counted with its parent
    run("00000002", "bbbbbbbb", "2026-10-14T10:00:00.000Z");
    attempt("00000002", "2026-10-14T10:00:00.000Z", "failed");

    const get = async (q: string) => (await h.api<RunStats>("GET", `/runs/stats?${q}`)).data;
    const berlin = await get("days=2&until=2026-10-15&tz=-60");
    expect(berlin.days.map((d) => [d.date, d.runs, d.passed, d.failed])).toEqual([
      ["2026-10-14", 1, 0, 1],
      ["2026-10-15", 1, 1, 0],
    ]);
    const oneUtcDay = await get("days=1&until=2026-10-14&pack=aaaaaaaa");
    expect(oneUtcDay.days[0]).toMatchObject({ runs: 1, passed: 1, failed: 0, medianMs: 1500 });
    expect((await h.api("GET", "/runs/stats?days=0")).status).toBe(400);
    expect((await h.api("GET", "/runs/stats?until=yesterday")).status).toBe(400);
  });
});
