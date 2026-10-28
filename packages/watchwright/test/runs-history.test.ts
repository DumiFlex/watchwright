import { afterEach, describe, expect, it } from "vitest";
import { RunsRepo, type AttemptStatus, type HistoryEntry } from "../src/plugins/runs/repo.js";
import { cleanTempDirs, tempDir } from "./helpers/fixtures.js";
import { startHarness, type Harness } from "./helpers/harness.js";

// Each test's history across a pack's runs, for the strip on the pack page. Rows are written
// straight into the store, so these tests need no browser.

const harnesses: Harness[] = [];
afterEach(async () => {
  for (const h of harnesses.splice(0)) await h.close();
  cleanTempDirs();
});

async function setup() {
  const h = await startHarness(tempDir("ww-data-"));
  harnesses.push(h);
  const repo = new RunsRepo(h.app.watchwright.store.db);
  let n = 0;
  const run = (id: string, pack: string, day: number, params: Record<string, unknown> = {}) =>
    repo.insertRun({
      id,
      pack_id: pack,
      pack_name: "Shop",
      pack_path: "/packs/shop",
      site_key: "shop",
      job_kind: "test",
      tests: "[]",
      params: JSON.stringify(params),
      options: "{}",
      label: day === 2 ? "nightly" : "",
      status: "finished",
      started_by: "api",
      created_at: `2026-10-0${day}T10:00:00.000Z`,
    });
  const attempt = (runId: string, test: string, day: number, status: AttemptStatus, number = 1) => {
    const id = (++n).toString(16).padStart(12, "0");
    repo.insertAttempt({ id, runId, kind: "test", itemId: test, title: test, number, of: 1, parentId: null, folder: () => "" });
    if (status !== "running") repo.finishAttempt(id, { status, flags: [], metrics: {}, notes: [], texts: {}, log: [], error: null });
    repo.db.prepare("UPDATE runs_attempts SET started_at = ?, finished_at = ? WHERE id = ?").run(`2026-10-0${day}T10:00:0${number}.000Z`, `2026-10-0${day}T10:00:0${number + 2}.500Z`, id);
    return id;
  };
  return { h, run, attempt };
}

describe("test history", () => {
  it("lists each test's finished attempts oldest first, newest kept by the limit", async () => {
    const { h, run, attempt } = await setup();
    run("00000001", "aaaaaaaa", 1, { lang: "de" });
    run("00000002", "aaaaaaaa", 2, { lang: "de" });
    run("00000003", "aaaaaaaa", 3, { lang: "en" });
    run("00000009", "bbbbbbbb", 3);
    attempt("00000001", "C1", 1, "passed");
    attempt("00000002", "C1", 2, "failed");
    attempt("00000002", "C1", 2, "passed", 2);
    attempt("00000003", "C1", 3, "broken");
    attempt("00000003", "H1", 3, "running"); // still going: not history yet
    attempt("00000003", "H1", 3, "skipped", 2);
    attempt("00000009", "C1", 3, "passed"); // another pack

    const all = (await h.api<Record<string, HistoryEntry[]>>("GET", "/packs/aaaaaaaa/history")).data;
    expect(Object.keys(all).sort()).toEqual(["C1", "H1"]);
    expect(all.C1!.map((e) => [e.runId, e.number, e.status])).toEqual([
      ["00000001", 1, "passed"],
      ["00000002", 1, "failed"],
      ["00000002", 2, "passed"],
      ["00000003", 1, "broken"],
    ]);
    expect(all.C1![1]).toMatchObject({ runLabel: "nightly", params: { lang: "de" }, try: 1, durationMs: 2500 });
    expect(all.H1!.map((e) => e.status)).toEqual(["skipped"]);

    const last2 = (await h.api<Record<string, HistoryEntry[]>>("GET", "/packs/aaaaaaaa/history?limit=2")).data;
    expect(last2.C1!.map((e) => e.status)).toEqual(["passed", "broken"]);
  });

  it("keeps only the try that counts, and says it was retried", async () => {
    const { h, run, attempt } = await setup();
    run("00000001", "aaaaaaaa", 1);
    attempt("00000001", "S1", 1, "broken");
    attempt("00000001", "S1", 1, "passed"); // a second try of the same attempt
    const all = (await h.api<Record<string, HistoryEntry[]>>("GET", "/packs/aaaaaaaa/history")).data;
    expect(all.S1!.map((e) => [e.status, e.try])).toEqual([["passed", 2]]);
  });

  it("is empty for a pack with no runs, and refuses a bad id or limit", async () => {
    const { h } = await setup();
    expect((await h.api("GET", "/packs/cccccccc/history")).data).toEqual({});
    expect((await h.api("GET", "/packs/nope/history")).status).toBe(400);
    expect((await h.api("GET", "/packs/cccccccc/history?limit=0")).status).toBe(400);
  });
});
