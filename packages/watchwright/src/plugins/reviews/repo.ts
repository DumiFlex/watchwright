import type Database from "better-sqlite3";
import type { Criterion, Score } from "../packs/rubric.js";

// Rows of the reviews plugin: one review per attempt per reviewer, and the rubric each run was
// started with (so a later change to the pack's rubric doesn't change what old runs are scored on).

export const REVIEWS_MIGRATION_SQL = `
  CREATE TABLE reviews (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id      TEXT NOT NULL,
    pack_id     TEXT NOT NULL,
    attempt_id  TEXT NOT NULL,
    test_id     TEXT NOT NULL,
    reviewer    TEXT NOT NULL,
    scores      TEXT NOT NULL DEFAULT '{}',
    note        TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    UNIQUE (attempt_id, reviewer)
  );
  CREATE INDEX reviews_run ON reviews (run_id);
  CREATE INDEX reviews_pack_test ON reviews (pack_id, test_id);

  CREATE TABLE reviews_rubrics (
    run_id      TEXT PRIMARY KEY,
    pack_id     TEXT NOT NULL,
    rubrics     TEXT NOT NULL,
    created_at  TEXT NOT NULL
  );
`;

export interface Review {
  runId: string;
  packId: string;
  attemptId: string;
  testId: string;
  reviewer: string;
  scores: Record<string, Score>;
  note: string;
  createdAt: string;
  updatedAt: string;
}

interface Row {
  run_id: string;
  pack_id: string;
  attempt_id: string;
  test_id: string;
  reviewer: string;
  scores: string;
  note: string;
  created_at: string;
  updated_at: string;
}

const toReview = (r: Row): Review => ({
  runId: r.run_id,
  packId: r.pack_id,
  attemptId: r.attempt_id,
  testId: r.test_id,
  reviewer: r.reviewer,
  scores: JSON.parse(r.scores) as Record<string, Score>,
  note: r.note,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export interface ReviewFilter {
  runId?: string | undefined;
  packId?: string | undefined;
  testId?: string | undefined;
  reviewer?: string | undefined;
}

export class ReviewsRepo {
  constructor(private readonly db: Database.Database) {}

  forAttempt(attemptId: string): Review[] {
    return (this.db.prepare("SELECT * FROM reviews WHERE attempt_id = ? ORDER BY updated_at").all(attemptId) as Row[]).map(toReview);
  }

  list(f: ReviewFilter): Review[] {
    const where: string[] = [];
    const args: string[] = [];
    for (const [col, value] of [
      ["run_id", f.runId],
      ["pack_id", f.packId],
      ["test_id", f.testId],
      ["reviewer", f.reviewer],
    ] as const) {
      if (!value) continue;
      where.push(`${col} = ?`);
      args.push(value);
    }
    const sql = `SELECT * FROM reviews ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY run_id, test_id, attempt_id, reviewer LIMIT 5000`;
    return (this.db.prepare(sql).all(...args) as Row[]).map(toReview);
  }

  save(r: Omit<Review, "createdAt" | "updatedAt">): Review {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO reviews (run_id, pack_id, attempt_id, test_id, reviewer, scores, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (attempt_id, reviewer) DO UPDATE SET scores = excluded.scores, note = excluded.note, updated_at = excluded.updated_at`,
      )
      .run(r.runId, r.packId, r.attemptId, r.testId, r.reviewer, JSON.stringify(r.scores), r.note, now, now);
    return toReview(this.db.prepare("SELECT * FROM reviews WHERE attempt_id = ? AND reviewer = ?").get(r.attemptId, r.reviewer) as Row);
  }

  deleteRun(runId: string): void {
    this.db.prepare("DELETE FROM reviews WHERE run_id = ?").run(runId);
    this.db.prepare("DELETE FROM reviews_rubrics WHERE run_id = ?").run(runId);
  }

  keepRubrics(runId: string, packId: string, rubrics: Record<string, Criterion[]>): void {
    this.db.prepare("INSERT OR IGNORE INTO reviews_rubrics (run_id, pack_id, rubrics, created_at) VALUES (?, ?, ?, ?)").run(runId, packId, JSON.stringify(rubrics), new Date().toISOString());
  }

  rubrics(runId: string): Record<string, Criterion[]> | null {
    const row = this.db.prepare("SELECT rubrics FROM reviews_rubrics WHERE run_id = ?").get(runId) as { rubrics: string } | undefined;
    return row ? (JSON.parse(row.rubrics) as Record<string, Criterion[]>) : null;
  }
}
