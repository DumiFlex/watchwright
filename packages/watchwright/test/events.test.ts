import { describe, expect, it } from "vitest";
import { EventLog, EVENTS_MIGRATION_SQL } from "../src/events/log.js";
import { openStore } from "../src/store/db.js";

const make = () => {
  const store = openStore(":memory:", { core: [{ id: 1, name: "events", sql: EVENTS_MIGRATION_SQL }] });
  return { store, log: new EventLog(store.db) };
};

describe("event log", () => {
  it("appends with growing sequence numbers and reads after a cursor", () => {
    const { log } = make();
    const a = log.append("run.queued", { x: 1 }, { runId: "r1" });
    const b = log.append("attempt.started", {}, { runId: "r1", attemptId: "a1" });
    log.append("pack.loaded", {});
    expect(b.seq).toBe(a.seq + 1);
    expect(log.after(0).map((e) => e.type)).toEqual(["run.queued", "attempt.started", "pack.loaded"]);
    expect(log.after(a.seq).map((e) => e.seq)).toEqual([b.seq, b.seq + 1]);
    expect(log.after(0, {}, 1)).toHaveLength(1);
    expect(log.head()).toBe(3);
    expect(log.after(0)[1]).toMatchObject({ runId: "r1", attemptId: "a1", data: {} });
  });

  it("filters by run (keeping events of no run) and by type patterns", () => {
    const { log } = make();
    log.append("run.started", {}, { runId: "r1" });
    log.append("run.started", {}, { runId: "r2" });
    log.append("pack.loaded", {});
    log.append("attempt.log", {}, { runId: "r1" });
    expect(log.after(0, { runId: "r1" }).map((e) => e.type)).toEqual(["run.started", "pack.loaded", "attempt.log"]);
    expect(log.after(0, { types: ["run.*"] })).toHaveLength(2);
    expect(log.after(0, { types: ["pack.loaded", "attempt.log"] })).toHaveLength(2);
  });

  it("refuses badly formed types", () => {
    const { log } = make();
    expect(() => log.append("Started", {})).toThrow(/namespaced/);
  });

  it("waits for the next matching event, or times out empty", async () => {
    const { log } = make();
    const waiting = log.wait(0, 2000, { types: ["run.finished"] });
    log.append("run.started", {});
    setTimeout(() => log.append("run.finished", {}), 20);
    const got = await waiting;
    expect(got.map((e) => e.type)).toEqual(["run.finished"]);
    expect(await log.wait(log.head(), 30)).toEqual([]);
  });

  it("stops waiting when the signal aborts", async () => {
    const { log } = make();
    const ctl = new AbortController();
    const waiting = log.wait(0, 10_000, {}, 500, ctl.signal);
    ctl.abort();
    expect(await waiting).toEqual([]);
  });
});

describe("the newest events of a run", () => {
  it("finds where the newest n log lines begin and counts the older ones", () => {
    const { log } = make();
    log.append("run.started", {}, { runId: "r1" });
    const lines = Array.from({ length: 5 }, (_, i) => log.append("attempt.log", { message: `l${i}` }, { runId: "r1" }));
    log.append("attempt.log", {}, { runId: "r2" });
    log.append("run.log", {}, { runId: "r1" });
    const types = ["attempt.log", "run.log"];
    // The newest three are l3, l4 and the run.log line: l0..l2 are older.
    expect(log.newest("r1", 0, types, 3)).toEqual({ cut: lines[2]!.seq, older: 3 });
    expect(log.newest("r1", lines[0]!.seq, types, 3)).toEqual({ cut: lines[2]!.seq, older: 2 });
    expect(log.newest("r1", 0, types, 6)).toEqual({ cut: 0, older: 0 });
    expect(log.newest("r3", 0, types, 1)).toEqual({ cut: 0, older: 0 });
  });
});
