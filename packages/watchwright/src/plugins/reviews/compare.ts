import path from "node:path";
import type { FlagRecord, MetricRecord } from "../../jobs/recorder.js";
import type { Criterion } from "../packs/rubric.js";
import type { RunDetail } from "../runs/engine.js";
import type { ResultDocument } from "../runs/results.js";
import type { Review } from "./repo.js";

// Lines up runs of one pack: the current attempts by test id and attempt number, one column per
// run. A run export is a comparison of one run, so the Markdown writer only knows this shape.

export interface CompareRun {
  id: string;
  /** The run's label; empty when it has none. */
  label: string;
  params: RunDetail["params"];
  info: RunDetail["info"];
  status: RunDetail["status"];
  startedBy: string;
  createdAt: string;
  startedAt: string | null;
  counts: RunDetail["counts"];
}

export interface CompareShot {
  name: string;
  url: string;
  /** Path relative to the data folder (for the zip export). */
  path: string;
  /** Scroll shots share their set's name. */
  set?: string;
}

/** A file the attempt kept besides its screenshots: kept texts, collector records, test and collector files. */
export interface CompareFile {
  name: string;
  url: string;
  /** Path relative to the data folder. */
  path: string;
  /** Path inside the attempt's folder (for the zip export). */
  at: string;
}

/** Artifact kinds an export carries as files (video and trace stay on the attempt page). */
export const EXPORT_FILE_KINDS = new Set(["text", "collector", "file"]);

export interface CompareCell {
  runId: string;
  attemptId: string;
  status: string;
  durationMs: number | null;
  error: string | null;
  flags: FlagRecord[];
  metrics: Record<string, MetricRecord>;
  notes: string[];
  texts: Record<string, string>;
  /** Every screenshot, in the order taken (marks included). */
  shots: CompareShot[];
  /** Kept texts, collector records and saved files, in the order saved. */
  files: CompareFile[];
  reviews: Review[];
  /** Mean of the scale scores on 1 to 5 over every reviewer; null when none. */
  score: number | null;
}

export interface CompareRow {
  testId: string;
  title: string;
  number: number;
  /** One per run, in the order of `runs`; null when the run has no such attempt. */
  cells: (CompareCell | null)[];
}

export interface Comparison {
  packId: string;
  packName: string;
  runs: CompareRun[];
  /** What each test is scored on (from the first run that has it). */
  criteria: Record<string, Criterion[]>;
  rows: CompareRow[];
  /** Screenshot names and kept text names seen anywhere, for the page's pickers. */
  shotNames: string[];
  textNames: string[];
}

/** A scale score put on 1 to 5, so scales of different lengths can be averaged. */
export function onFive(v: number, scale: number): number {
  return scale <= 1 ? 5 : 1 + ((v - 1) / (scale - 1)) * 4;
}

export function attemptScore(criteria: readonly Criterion[], reviews: readonly Pick<Review, "scores">[]): number | null {
  const values: number[] = [];
  for (const r of reviews)
    for (const c of criteria) {
      const v = r.scores[c.id];
      if (c.kind === "scale" && typeof v === "number") values.push(onFive(v, c.scale));
    }
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

export function mean(values: readonly (number | null)[]): number | null {
  const xs = values.filter((v): v is number => v !== null);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

export interface CompareInput {
  run: RunDetail;
  /** Result documents of the run's current attempts. */
  results: ResultDocument[];
  reviews: Review[];
  criteria: (testId: string) => Criterion[];
}

export function compare(inputs: readonly CompareInput[]): Comparison {
  const first = inputs[0]?.run;
  if (!first) throw new Error("Nothing to compare.");
  const rows = new Map<string, CompareRow>();
  const criteria: Record<string, Criterion[]> = {};
  const shotNames = new Set<string>();
  const textNames = new Set<string>();
  const rowFor = (testId: string, title: string, number: number) => {
    const key = `${testId}\u0000${number}`;
    let row = rows.get(key);
    if (!row) {
      row = { testId, title, number, cells: inputs.map(() => null) };
      rows.set(key, row);
    }
    return row;
  };
  // Rows in the first run's order; tests only later runs have come after, in their order.
  for (const { run } of inputs) for (const p of run.plan) rowFor(p.testId, p.title, p.number);

  inputs.forEach(({ run, results, reviews, criteria: criteriaOf }, i) => {
    const byAttempt = new Map<string, Review[]>();
    for (const r of reviews) byAttempt.set(r.attemptId, [...(byAttempt.get(r.attemptId) ?? []), r]);
    for (const doc of results) {
      if (!doc.attempt.current) continue;
      const testId = doc.test.id;
      criteria[testId] ??= criteriaOf(testId);
      const shots = doc.artifacts
        .filter((a) => a.kind === "shot" || a.kind === "mark")
        .map((a): CompareShot => ({ name: a.name, url: a.url, path: a.path, ...(a.set ? { set: a.set } : {}) }));
      for (const s of shots) shotNames.add(s.set ?? s.name);
      const files = doc.artifacts
        .filter((a) => EXPORT_FILE_KINDS.has(a.kind))
        .map((a): CompareFile => {
          const at = path.posix.relative(doc.folder, a.path);
          return { name: a.name, url: a.url, path: a.path, at: at && !at.startsWith("..") ? at : path.posix.basename(a.path) };
        });
      for (const t of Object.keys(doc.texts)) textNames.add(t);
      const own = byAttempt.get(doc.attemptId) ?? [];
      rowFor(testId, doc.test.title, doc.attempt.number).cells[i] = {
        runId: run.id,
        attemptId: doc.attemptId,
        status: doc.status,
        durationMs: doc.durationMs,
        error: doc.error?.message ?? null,
        flags: doc.flags,
        metrics: doc.metrics,
        notes: doc.notes,
        texts: doc.texts,
        shots,
        files,
        reviews: own,
        score: attemptScore(criteria[testId], own),
      };
    }
  });

  return {
    packId: first.packId,
    packName: first.packName,
    runs: inputs.map(({ run }) => ({
      id: run.id,
      label: run.label ?? "",
      params: run.params,
      info: run.info ?? {},
      status: run.status,
      startedBy: run.startedBy,
      createdAt: run.createdAt,
      startedAt: run.startedAt,
      counts: run.counts,
    })),
    criteria,
    rows: [...rows.values()],
    shotNames: [...shotNames],
    textNames: [...textNames],
  };
}
