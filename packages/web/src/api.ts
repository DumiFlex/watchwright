// Talks to the Watchwright server. Shapes mirror packages/watchwright/src (plugins/packs, plugins/runs).

export interface HealthData {
  name: "watchwright";
  version: string;
  dataDir: string;
  plugins: { name: string; schemaVersion: number }[];
}

export interface ApiError {
  code: string;
  message: string;
  detail?: unknown;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

export type ParamValue = string | number | boolean;

export interface ParamDef {
  type: "string" | "number" | "boolean";
  choices?: (string | number)[];
  default?: ParamValue;
  description?: string;
  labels?: Record<string, string>;
}

/** A review criterion: a 1-to-N scale, named choices, or yes/no. */
export type Criterion = { id: string; title: string; description: string | null } & (
  | { kind: "scale"; scale: number }
  | { kind: "choices"; choices: string[] }
  | { kind: "yesNo" }
);
export type Score = number | string | boolean;

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

export interface AttemptReviews {
  criteria: Criterion[];
  reviews: Review[];
}

export interface PackTest {
  id: string;
  title: string;
  section: string | null;
  tags: string[];
  needs: string[];
  inside: string[];
  description: string | null;
  runs: number | Record<string, unknown> | "computed";
  file: string;
  rubric: Criterion[];
}

export interface Pack {
  id: string;
  /** The pack file. */
  path: string;
  /** The pack's folder. */
  dir: string;
  /** The pack file is gone: the folder moved or was deleted. */
  missing: boolean;
  name: string;
  description: string | null;
  siteKey: string | null;
  baseURL: string | null;
  browser: string;
  status: "ok" | "error";
  error: string | null;
  problems: string[];
  loadedAt: string | null;
  params: Record<string, ParamDef>;
  flags: Record<string, "robot" | "finding" | "info">;
  run: PackRunDefaults;
  rubric: Criterion[];
  tests: PackTest[];
}

export interface FolderEntry {
  name: string;
  path: string;
  /** Markers found in the folder, such as `{ pack: "pack.ts" }`. */
  marks: Record<string, string>;
}

export interface FolderListing {
  path: string;
  parent: string | null;
  sep: string;
  marks: Record<string, string>;
  folders: FolderEntry[];
  truncated: boolean;
}

export interface FolderPlaces {
  home: string;
  sep: string;
  roots: string[];
  recent: { path: string; usedAt: string; exists: boolean }[];
}

export interface FoundPack {
  dir: string;
  packFile: string;
  packId: string | null;
}

export function folderUrl(path: string): string {
  return `/api/v1/folders?path=${encodeURIComponent(path)}`;
}

export type TraceMode = "problems" | "always" | "never";

export interface PackRunDefaults {
  pauseOnBroken: boolean;
  pauseLimitMinutes: number;
  trace: TraceMode;
  video: boolean;
}

/** What a run sets for itself; anything left out comes from the pack. */
export interface RunOptions {
  pauseOnBroken?: boolean;
  pauseLimitMinutes?: number;
  attempts?: number;
  trace?: TraceMode;
  video?: boolean;
}

/** What a run starts with apart from its pack: what a preset keeps. */
export interface RunChoices extends RunOptions {
  tests?: string[];
  params?: Record<string, ParamValue>;
}

export interface Preset {
  id: string;
  packId: string;
  name: string;
  choices: RunChoices;
  createdAt: string;
  updatedAt: string;
}

/** A run's name for lists and titles: its label, else its id. */
export const runName = (r: { id: string; label?: string }) => r.label || r.id;

export interface PlanEntry {
  testId: string;
  title: string;
  number: number;
  of: number;
  children?: string[];
}

export interface RunPreview {
  params: Record<string, ParamValue>;
  attempts: number;
  plan: PlanEntry[];
  joined: { testId: string; reason: "needed" | "parent" | "inside"; of: string[] }[];
}

export type RunStatus = "queued" | "running" | "pausing" | "paused" | "finished" | "stopped" | "interrupted" | "failed_to_start";
export type AttemptStatus = "passed" | "failed" | "broken" | "skipped" | "stopped" | "running" | "interrupted";

export interface RunSummary {
  id: string;
  packId: string;
  packName: string;
  siteKey: string;
  tests: string[];
  params: Record<string, ParamValue>;
  /** Facts the run saved while it ran (the app's version, the model it used). */
  info: Record<string, ParamValue>;
  options: RunOptions;
  /** A name the person gave the run; empty when none. */
  label: string;
  status: RunStatus;
  mode: "normal" | "resume" | "redo";
  startedBy: string;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  counts: Record<AttemptStatus, number> & { planned: number };
}

export interface Attempt {
  id: string;
  testId: string;
  title: string;
  number: number;
  of: number;
  try: number;
  parentId: string | null;
  status: AttemptStatus;
  flags: { name: string; kind: string; detail: string | null }[];
  error: { kind: string; message: string } | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
}

export interface LiveSnapshot {
  state: "running" | "pausing" | "paused";
  pauseReason: "manual" | "broken" | null;
  deadline: string | null;
  stopping: "after" | "now" | null;
  attemptId: string | null;
  testId: string | null;
  step: string | null;
  pages: { id: string; url: string }[];
  activePageId: string | null;
}

export interface RunDetail extends RunSummary {
  plan: { testId: string; title: string; number: number; of: number; children?: string[]; skip?: boolean; status: AttemptStatus | "pending"; attemptId: string | null }[];
  attempts: Attempt[];
  live: LiveSnapshot | null;
}

export interface Artifact {
  kind: string;
  name: string;
  contentType: string;
  url: string;
  size: number;
  /** Shots taken as one set (scroll shots) share the set's name. */
  set?: string;
}

export interface ResultDocument {
  schemaVersion: 1;
  runId: string;
  attemptId: string;
  test: { id: string; title: string };
  attempt: { number: number; of: number; try: number; current: boolean; parentId: string | null };
  status: AttemptStatus;
  error: { kind: string; message: string; stack?: string | null } | null;
  notes: string[];
  texts: Record<string, string>;
  metrics: Record<string, { value: number; unit: string | null }>;
  flags: { name: string; kind: string; detail: string | null }[];
  log: { time: string; level: "info" | "warn" | "error"; message: string }[];
  /** Named steps with their times (older results have none). */
  steps?: StepRecord[];
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  artifacts: Artifact[];
}

export interface StepRecord {
  title: string;
  depth: number;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "passed" | "failed";
}

export interface CompareShot {
  name: string;
  url: string;
  path: string;
  set?: string;
}

export interface CompareCell {
  runId: string;
  attemptId: string;
  status: AttemptStatus;
  durationMs: number | null;
  error: string | null;
  flags: { name: string; kind: string; detail: string | null }[];
  metrics: Record<string, { value: number; unit: string | null }>;
  notes: string[];
  texts: Record<string, string>;
  shots: CompareShot[];
  reviews: Review[];
  score: number | null;
}

/** Runs of one pack lined up by test and attempt number (GET /compare). */
export interface Comparison {
  packId: string;
  packName: string;
  runs: Pick<RunSummary, "id" | "label" | "params" | "info" | "status" | "startedBy" | "createdAt" | "startedAt" | "counts">[];
  criteria: Record<string, Criterion[]>;
  rows: { testId: string; title: string; number: number; cells: (CompareCell | null)[] }[];
  shotNames: string[];
  textNames: string[];
}

export type Change = "status" | "flags" | "score" | "time" | "new" | "gone";

export interface ChangeSide {
  runId: string;
  attemptId: string;
  status: AttemptStatus;
  durationMs: number | null;
  score: number | null;
  flags: string[];
}

/** What changed in a run since an earlier run of the same pack and params (GET /runs/:id/changes). */
export interface RunChanges {
  previous: Comparison["runs"][number] | null;
  rows: { testId: string; title: string; number: number; before: ChangeSide | null; after: ChangeSide | null; changes: Change[] }[];
  same: number;
}

export interface WwEvent {
  seq: number;
  time: string;
  type: string;
  runId?: string;
  attemptId?: string;
  data: Record<string, unknown>;
}

async function call<T>(url: string, init: RequestInit, fetcher: typeof fetch): Promise<ApiResult<T>> {
  try {
    const res = await fetcher(url, init);
    const body = (await res.json().catch(() => null)) as { data?: T; error?: ApiError } | null;
    if (res.ok && body && "data" in body) return { ok: true, data: body.data as T };
    return { ok: false, error: body?.error ?? { code: `http_${res.status}`, message: `The server answered ${res.status}.` } };
  } catch {
    return { ok: false, error: { code: "unreachable", message: "Can't reach the Watchwright server." } };
  }
}

export function getJson<T>(url: string, fetcher: typeof fetch = fetch): Promise<ApiResult<T>> {
  return call<T>(url, { headers: { accept: "application/json" } }, fetcher);
}

/** POST (or DELETE) with a JSON body. The web app names itself, so runs show "started by web". */
export function sendJson<T>(url: string, body: unknown = {}, method: "POST" | "DELETE" = "POST", fetcher: typeof fetch = fetch): Promise<ApiResult<T>> {
  const init: RequestInit =
    method === "DELETE"
      ? { method, headers: { accept: "application/json", "x-watchwright-client": "web" } }
      : { method, headers: { accept: "application/json", "content-type": "application/json", "x-watchwright-client": "web" }, body: JSON.stringify(body) };
  return call<T>(url, init, fetcher);
}

/** The live WebSocket address for the page's own origin (http → ws, https → wss). */
export function liveUrl(location: Pick<Location, "protocol" | "host">): string {
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${location.host}/api/v1/live`;
}

export interface FrameHeader {
  runId: string;
  pageId: string;
  timestamp: number;
  width: number;
  height: number;
}

/** Splits a binary frame message: 4-byte big-endian header length, JSON header, JPEG bytes. */
export function decodeFrame(buf: ArrayBuffer): { header: FrameHeader; jpeg: Uint8Array } {
  const len = new DataView(buf).getUint32(0, false);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, len))) as FrameHeader;
  return { header, jpeg: new Uint8Array(buf, 4 + len) };
}
