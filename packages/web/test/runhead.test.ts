import { computed, nextTick, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import type { Attempt, RunDetail } from "../src/api";

const setTitle = vi.fn();
const setIconDot = vi.fn(async () => {});
vi.mock("../src/pagehead", () => ({ setTitle, setIconDot }));

const { followRunHead } = await import("../src/runhead");
const { applyAttempt } = await import("../src/run-patch");

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
    live: { state: "running", pauseReason: null, deadline: null, stopping: null, attemptId: null, testId: null, step: null, pages: [], activePageId: null, settings: null },
  } as RunDetail;
}

describe("followRunHead", () => {
  it("follows counts and pauses that live events patch into the run in place", async () => {
    const r = ref<RunDetail | null>(null);
    const live = computed(() => r.value?.live ?? null);
    const stop = followRunHead(r, live);
    expect(setTitle).not.toHaveBeenCalled();

    r.value = run();
    await nextTick();
    expect(setTitle).toHaveBeenLastCalledWith("Running 0/2 · P r1 · Watchwright");
    expect(setIconDot).toHaveBeenLastCalledWith("accent");

    // An attempt finishing patches the counts on the same object, as the run page does.
    applyAttempt(r.value, attempt({ status: "passed", finishedAt: "2026-11-02T10:00:01.000Z", durationMs: 1000 }), false);
    await nextTick();
    expect(setTitle).toHaveBeenLastCalledWith("Running 1/2 · P r1 · Watchwright");

    r.value.live!.state = "paused";
    r.value.live!.pauseReason = "manual";
    await nextTick();
    expect(setTitle).toHaveBeenLastCalledWith("Paused · P r1 · Watchwright");
    expect(setIconDot).toHaveBeenLastCalledWith("paused");
    stop();
  });
});
