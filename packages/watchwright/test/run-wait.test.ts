import { describe, expect, it } from "vitest";
import { EventLog, EVENTS_MIGRATION_SQL } from "../src/events/log.js";
import { waitForRun } from "../src/plugins/runs/digest.js";
import type { Engine, RunDetail } from "../src/plugins/runs/engine.js";
import { openStore } from "../src/store/db.js";

// The run wait on a busy run: it wakes on every event, so it must not read the whole run each time.

function fakeEngine(status: () => RunDetail["status"]) {
  const calls = { get: 0 };
  const detail = (): RunDetail => ({
    id: "0a1b2c3d",
    packId: "deadbeef",
    packName: "Pack",
    status: status(),
    label: "",
    startedBy: "test",
    error: null,
    counts: { planned: 1 },
    plan: [],
    attempts: [],
    live: null,
  }) as unknown as RunDetail;
  const engine = {
    status: (id: string) => (id === "0a1b2c3d" ? status() : null),
    get: (id: string) => {
      calls.get++;
      return id === "0a1b2c3d" ? detail() : null;
    },
  } as unknown as Engine;
  return { engine, calls };
}

describe("run wait", () => {
  it("reads the whole run once, when it returns, however many events wake it", async () => {
    const store = openStore(":memory:", { core: [{ id: 1, name: "events", sql: EVENTS_MIGRATION_SQL }] });
    const events = new EventLog(store.db);
    let status: RunDetail["status"] = "running";
    const { engine, calls } = fakeEngine(() => status);
    const waiting = waitForRun(engine, events, "0a1b2c3d", 0, 5000, new AbortController().signal);
    for (let i = 0; i < 200; i++) {
      events.append("attempt.log", { level: "info", message: `line ${i}` }, { runId: "0a1b2c3d" });
      await new Promise((r) => setImmediate(r));
    }
    status = "finished";
    events.append("run.finished", { status: "finished" }, { runId: "0a1b2c3d" });
    const result = await waiting;
    expect(result?.reason).toBe("ended");
    expect(result?.run.status).toBe("finished");
    expect(calls.get).toBe(1);
    store.close();
  });

  it("answers null for a run that doesn't exist", async () => {
    const store = openStore(":memory:", { core: [{ id: 1, name: "events", sql: EVENTS_MIGRATION_SQL }] });
    const { engine } = fakeEngine(() => "running");
    expect(await waitForRun(engine, new EventLog(store.db), "ffffffff", 0, 100, new AbortController().signal)).toBeNull();
    store.close();
  });
});
