// Pure helpers for reviews: how a score reads, and one number per attempt for the results grid.
import type { Criterion, Review, RunDetail, Score } from "./api";

/** A score as text: "4 / 5", "minor", "yes". */
export function scoreText(c: Criterion, v: Score | undefined): string {
  if (v === undefined) return "–";
  if (c.kind === "scale") return `${v} / ${c.scale}`;
  if (c.kind === "yesNo") return v ? "yes" : "no";
  return String(v);
}

/** A scale score put on 1 to 5, so scales of different lengths can be averaged. */
export function onFive(v: number, scale: number): number {
  return scale <= 1 ? 5 : 1 + ((v - 1) / (scale - 1)) * 4;
}

/**
 * One number for an attempt: the mean of its scale scores on 1 to 5, over every reviewer.
 * Null when nobody gave it a scale score.
 */
export function attemptScore(criteria: readonly Criterion[], reviews: readonly Pick<Review, "scores">[]): number | null {
  const values: number[] = [];
  for (const r of reviews)
    for (const c of criteria) {
      const v = r.scores[c.id];
      if (c.kind === "scale" && typeof v === "number") values.push(onFive(v, c.scale));
    }
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

/** The mean of the numbers that are there, or null. */
export function mean(values: readonly (number | null)[]): number | null {
  const xs = values.filter((v): v is number => v !== null);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

export interface ResultCell {
  attemptId: string;
  status: string;
  flags: number;
  score: number | null;
  reviewed: boolean;
}

export interface ResultRow {
  testId: string;
  title: string;
  /** The test this one runs inside, for children. */
  parent: string | null;
  /** By attempt number. */
  cells: Record<number, ResultCell>;
  /** The mean of the row's attempt scores. */
  score: number | null;
}

/** The run's results as tests × attempts, in run order with children after their parent. */
export function resultRows(run: Pick<RunDetail, "plan" | "attempts">, reviews: readonly Review[], rubric: Record<string, Criterion[]>): ResultRow[] {
  const byAttempt = new Map<string, Review[]>();
  for (const r of reviews) byAttempt.set(r.attemptId, [...(byAttempt.get(r.attemptId) ?? []), r]);
  const testOf = new Map(run.attempts.map((a) => [a.id, a.testId]));
  const order: { testId: string; parent: string | null }[] = [];
  const seen = new Set<string>();
  for (const p of run.plan) {
    if (seen.has(p.testId)) continue;
    seen.add(p.testId);
    order.push({ testId: p.testId, parent: null });
    for (const a of run.attempts) {
      if (!a.parentId || testOf.get(a.parentId) !== p.testId || seen.has(a.testId)) continue;
      seen.add(a.testId);
      order.push({ testId: a.testId, parent: p.testId });
    }
  }
  return order.map(({ testId, parent }) => {
    const cells: Record<number, ResultCell> = {};
    for (const a of run.attempts.filter((x) => x.testId === testId)) {
      const rs = byAttempt.get(a.id) ?? [];
      cells[a.number] = { attemptId: a.id, status: a.status, flags: a.flags.length, score: attemptScore(rubric[testId] ?? [], rs), reviewed: rs.length > 0 };
    }
    const title = run.plan.find((p) => p.testId === testId)?.title ?? run.attempts.find((a) => a.testId === testId)?.title ?? testId;
    return { testId, title, parent, cells, score: mean(Object.values(cells).map((c) => c.score)) };
  });
}

/** Which result rows to show: all, ones with a failed or broken attempt, ones not reviewed yet, or flagged ones. */
export type ResultShow = "all" | "problems" | "unreviewed" | "flagged";

/** The rows that match the search (every word in the id or title) and the `show` choice. */
export function filterResults(rows: readonly ResultRow[], search: string, show: ResultShow): ResultRow[] {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((r) => {
    const cells = Object.values(r.cells);
    if (show === "problems" && !cells.some((c) => c.status === "failed" || c.status === "broken")) return false;
    if (show === "unreviewed" && !cells.some((c) => !c.reviewed)) return false;
    if (show === "flagged" && !cells.some((c) => c.flags > 0)) return false;
    const text = `${r.testId} ${r.title}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
}
