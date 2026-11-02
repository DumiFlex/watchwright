// Keeps an open run's page current from its events, so the page doesn't fetch the whole run (the
// plan and every attempt: hundreds of KB on a long run) each time an attempt starts or finishes.
// The server sends the attempt's row with `attempt.started` and `attempt.finished`; the page still
// fetches the run when it opens, when the live channel reconnects and on run-level events.
import type { Attempt, AttemptStatus, RunDetail, WwEvent } from "./api";

/** The attempt row an `attempt.started` or `attempt.finished` event carries, if the server sent one. */
export function eventAttempt(e: WwEvent): Attempt | null {
  const a = e.data.attempt as Attempt | null | undefined;
  return a && typeof a === "object" && typeof a.id === "string" ? a : null;
}

/**
 * Patches made while a fetch of the run is on its way, put again onto what the fetch returns
 * (which may be older than they are).
 */
export class AttemptPatches {
  private since: [Attempt, boolean][] | null = null;
  /** Call as a fetch starts. */
  begin(): void {
    this.since = [];
  }
  /** Applies an attempt now, and again after the fetch on its way, if there is one. */
  apply(run: RunDetail, a: Attempt, started: boolean): void {
    applyAttempt(run, a, started);
    this.since?.push([a, started]);
  }
  /** Call with the fetched run (or null when the fetch failed). */
  end(run: RunDetail | null): void {
    const since = this.since ?? [];
    this.since = null;
    if (run) for (const [a, started] of since) applyAttempt(run, a, started);
  }
}

/**
 * Puts an attempt into the run as the server would list it: it replaces an older try of the same
 * test and number, the plan row shows its status, the counts follow, and the live view's current
 * attempt moves to it when it starts and back to its parent (or none) when it ends.
 */
export function applyAttempt(run: RunDetail, a: Attempt, started: boolean): void {
  // The server lists current tries only, in the order they started. A row never goes back from
  // finished to running: a fetch that was on its way can bring a newer row than an event.
  const i = run.attempts.findIndex((x) => x.id === a.id);
  if (i >= 0) {
    if (run.attempts[i]!.finishedAt && !a.finishedAt) return;
    run.attempts[i] = a;
  } else run.attempts = run.attempts.filter((x) => !(x.testId === a.testId && x.number === a.number)).concat(a);

  const top = new Map(run.attempts.filter((x) => x.parentId === null).map((x) => [`${x.testId}#${x.number}`, x]));
  for (const p of run.plan) {
    const x = top.get(`${p.testId}#${p.number}`);
    p.status = x?.status ?? "pending";
    p.attemptId = x?.id ?? null;
  }

  const counts: Record<AttemptStatus, number> = { passed: 0, failed: 0, broken: 0, skipped: 0, stopped: 0, running: 0, interrupted: 0 };
  for (const x of top.values()) counts[x.status] += 1;
  run.counts = { ...counts, planned: run.counts.planned };

  const live = run.live;
  if (!live) return;
  if (started) {
    live.attemptId = a.id;
    live.testId = a.testId;
    live.step = null;
  } else if (live.attemptId === a.id) {
    const parent = a.parentId ? run.attempts.find((x) => x.id === a.parentId) : undefined;
    live.attemptId = parent?.id ?? null;
    live.testId = parent?.testId ?? null;
  }
}
