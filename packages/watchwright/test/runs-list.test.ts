import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RunsRepo, type RunStatus, type RunSummary } from "../src/plugins/runs/repo.js";
import { cleanTempDirs, tempDir } from "./helpers/fixtures.js";
import { startHarness, type Harness } from "./helpers/harness.js";

// Listing runs with filters and a cursor, and deleting them. Rows are written straight into the
// store, so these tests need no browser.

const harnesses: Harness[] = [];
afterEach(async () => {
  for (const h of harnesses.splice(0)) await h.close();
  cleanTempDirs();
});

async function withRuns(rows: { id: string; pack: string; status: RunStatus; at: string }[]) {
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
      params: "{}",
      options: "{}",
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
});
