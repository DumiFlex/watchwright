import { describe, expect, it } from "vitest";
import type { Attempt, RunDetail } from "../src/api";
import { applyAttempt, AttemptPatches, eventAttempt } from "../src/run-patch";

function attempt(over: Partial<Attempt>): Attempt {
  return { id: "a1", kind: "test", testId: "T1", title: "T1", number: 1, of: 1, try: 1, parentId: null, status: "running", flags: [], error: null, startedAt: "2026-11-02T10:00:00.000Z", finishedAt: null, durationMs: null, ...over };
}

function run(): RunDetail {
  const counts = { passed: 0, failed: 0, broken: 0, skipped: 0, stopped: 0, running: 0, interrupted: 0, planned: 2 };
  return {
    id: "r1", packId: "p", packName: "P", siteKey: "s", kind: "test", tests: [], params: {}, info: {}, options: {}, label: "", status: "running", mode: "normal",
    startedBy: "web", error: null, createdAt: "", startedAt: "", finishedAt: null, counts,
    plan: [
      { testId: "T1", title: "T1", number: 1, of: 1, status: "pending", attemptId: null },
      { testId: "T2", title: "T2", number: 1, of: 1, status: "pending", attemptId: null },
    ],
    attempts: [],
    live: { state: "running", pauseReason: null, deadline: null, stopping: null, attemptId: null, testId: null, step: "old", pages: [], activePageId: null, settings: null },
  } as RunDetail;
}

describe("applyAttempt", () => {
  it("adds a started attempt, then its finished row, and keeps the plan, counts and live view in step", () => {
    const r = run();
    applyAttempt(r, attempt({}), true);
    expect(r.plan[0]).toMatchObject({ status: "running", attemptId: "a1" });
    expect(r.counts).toMatchObject({ running: 1, passed: 0, planned: 2 });
    expect(r.live).toMatchObject({ attemptId: "a1", testId: "T1", step: null });

    applyAttempt(r, attempt({ status: "passed", finishedAt: "2026-11-02T10:00:01.000Z", durationMs: 1000 }), false);
    expect(r.attempts).toHaveLength(1);
    expect(r.plan[0]!.status).toBe("passed");
    expect(r.counts).toMatchObject({ running: 0, passed: 1 });
    expect(r.live).toMatchObject({ attemptId: null, testId: null });
  });

  it("replaces an older try of the same test and number", () => {
    const r = run();
    applyAttempt(r, attempt({ status: "broken", finishedAt: "x" }), false);
    applyAttempt(r, attempt({ id: "a2", try: 2 }), true);
    expect(r.attempts.map((a) => a.id)).toEqual(["a2"]);
    expect(r.counts).toMatchObject({ broken: 0, running: 1 });
  });

  it("counts child attempts out and hands the live view back to the parent", () => {
    const r = run();
    applyAttempt(r, attempt({}), true);
    applyAttempt(r, attempt({ id: "c1", testId: "C1", parentId: "a1" }), true);
    expect(r.counts.running).toBe(1);
    expect(r.live?.attemptId).toBe("c1");
    applyAttempt(r, attempt({ id: "c1", testId: "C1", parentId: "a1", status: "passed", finishedAt: "x" }), false);
    expect(r.live).toMatchObject({ attemptId: "a1", testId: "T1" });
  });

  it("never takes a finished row back to running", () => {
    const r = run();
    applyAttempt(r, attempt({ status: "failed", finishedAt: "x" }), false);
    applyAttempt(r, attempt({}), true);
    expect(r.attempts[0]!.status).toBe("failed");
    expect(r.live?.attemptId).toBeNull();
  });
});

describe("AttemptPatches", () => {
  it("puts patches made during a fetch onto the fetched run", () => {
    const p = new AttemptPatches();
    const shown = run();
    p.begin();
    p.apply(shown, attempt({}), true);
    p.apply(shown, attempt({ status: "passed", finishedAt: "x" }), false);
    const fetched = run(); // fetched before the attempt started
    p.end(fetched);
    expect(fetched.plan[0]!.status).toBe("passed");
    expect(fetched.counts.passed).toBe(1);
    // Without a fetch on its way nothing is kept.
    const later = run();
    p.apply(shown, attempt({ id: "b1", testId: "T2" }), true);
    p.end(later);
    expect(later.attempts).toEqual([]);
  });
});

describe("eventAttempt", () => {
  it("reads the attempt an event carries, or null", () => {
    const e = { seq: 1, time: "", type: "attempt.started", runId: "r1", attemptId: "a1", data: { attempt: attempt({}) } };
    expect(eventAttempt(e)?.id).toBe("a1");
    expect(eventAttempt({ ...e, data: {} })).toBeNull();
    expect(eventAttempt({ ...e, data: { attempt: null } })).toBeNull();
  });
});
