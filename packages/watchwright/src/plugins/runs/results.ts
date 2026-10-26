import type { ArtifactInfo, FlagRecord, LogLine, MetricRecord } from "../../jobs/recorder.js";
import type { AttemptError } from "../testing/outcome.js";
import type { AttemptRow, AttemptStatus } from "./repo.js";

/** Bumped only for changes old readers can't ignore; new fields are added without a bump. */
export const RESULT_SCHEMA_VERSION = 1;

/** One attempt's result: what `GET /runs/:id/attempts/:attemptId` returns and `result.json` holds. */
export interface ResultDocument {
  schemaVersion: 1;
  runId: string;
  attemptId: string;
  kind: string;
  test: { id: string; title: string };
  attempt: { number: number; of: number; try: number; current: boolean; parentId: string | null };
  status: AttemptStatus;
  error: AttemptError | null;
  flags: FlagRecord[];
  metrics: Record<string, MetricRecord>;
  notes: string[];
  texts: Record<string, string>;
  log: LogLine[];
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  /** Folder of the attempt, relative to the data folder. */
  folder: string;
  artifacts: (ArtifactInfo & { url: string })[];
}

export function fileUrl(rel: string): string {
  return `/api/v1/files/${rel.split("/").map(encodeURIComponent).join("/")}`;
}

export function resultDocument(a: AttemptRow, artifacts: ArtifactInfo[]): ResultDocument {
  return {
    schemaVersion: RESULT_SCHEMA_VERSION,
    runId: a.run_id,
    attemptId: a.id,
    kind: a.job_kind,
    test: { id: a.item_id, title: a.title },
    attempt: { number: a.number, of: a.of_count, try: a.try, current: a.current === 1, parentId: a.parent_id },
    status: a.status,
    error: a.error ? (JSON.parse(a.error) as AttemptError) : null,
    flags: JSON.parse(a.flags) as FlagRecord[],
    metrics: JSON.parse(a.metrics) as Record<string, MetricRecord>,
    notes: JSON.parse(a.notes) as string[],
    texts: JSON.parse(a.texts) as Record<string, string>,
    log: JSON.parse(a.log) as LogLine[],
    startedAt: a.started_at,
    finishedAt: a.finished_at,
    durationMs: a.finished_at ? Date.parse(a.finished_at) - Date.parse(a.started_at) : null,
    folder: a.folder,
    artifacts: artifacts.map((x) => ({ ...x, url: fileUrl(x.path) })),
  };
}
