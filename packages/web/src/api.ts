// Talks to the Watchwright server. Shapes mirror packages/watchwright/src (plugins/packs, plugins/runs).
import type { TileGroupResult } from "./dashboard";

export interface HealthData {
  name: "watchwright";
  version: string;
  dataDir: string;
  plugins: { name: string; schemaVersion: number }[];
  /** The web app's pages the loaded plugins bring, in menu order. */
  pages: HealthPage[];
  /** Login: on, who is signed in, whether the first admin is still to be made. */
  login?: { on: boolean; user: { id: string; name: string; role: string } | null; setupNeeded: boolean };
}

/** A page a plugin brings (`PluginPage` on the server). */
export interface HealthPage {
  plugin: string;
  name: string;
  title: string;
  /** The address after `#`. */
  path: string;
  /** A Lucide icon name from src/icons.ts. */
  icon: string;
  menu: "main" | "more";
  order: number;
  words?: string;
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
  /** For a YAML test, the line it starts on in its file; null for a code test. */
  line: number | null;
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
  /** Steps that run on their own, as runs of the `task` kind. */
  tasks: PackTask[];
  /** Which run hooks the pack has. */
  hooks: { setup: boolean; teardown: boolean; afterTask: boolean };
}

export interface PackTask {
  id: string;
  title: string;
  description: string | null;
  readOnly: boolean;
}

/** One value a pack keeps between runs and tasks. */
export interface PackStateEntry {
  key: string;
  value: unknown;
  updatedAt: string;
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
  /** Where the folder browser opens (the first allowed folder on a server that limits browsing); older servers leave it out. */
  start?: string;
  sep: string;
  roots: string[];
  /** Folders can be shown in a file manager (not on a server without a screen); older servers leave it out. */
  canOpen?: boolean;
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
export type VideoMode = "always" | "problems" | "never";

/** The mode a stored video setting means: `true` is always, `false` never (older runs and presets). */
export function videoMode(v: VideoMode | boolean | undefined, fallback: VideoMode = "always"): VideoMode {
  return v === undefined ? fallback : v === true ? "always" : v === false ? "never" : v;
}

export interface PackRunDefaults {
  pauseOnBroken: boolean;
  pauseLimitMinutes: number;
  trace: TraceMode;
  /** Older servers say true or false. */
  video: VideoMode | boolean;
  runVideo?: boolean;
  /** Runs start with the site's saved sign-in (`site.signIn: saved`); older servers leave it out. */
  signIn?: boolean;
  /** Where runs reach the site from (`site.network`): "server" or a runner's name; older servers leave it out. */
  network?: string;
}

/** What a run sets for itself; anything left out comes from the pack. */
export interface RunOptions {
  pauseOnBroken?: boolean;
  pauseLimitMinutes?: number;
  attempts?: number;
  trace?: TraceMode;
  video?: VideoMode | boolean;
  runVideo?: boolean;
  signIn?: boolean;
  /** "server" or a runner's name. */
  network?: string;
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

/** One finished attempt of a test (`GET /packs/:id/history`), oldest first per test. */
export interface HistoryEntry {
  attemptId: string;
  runId: string;
  runLabel: string;
  number: number;
  /** Above 1 when the attempt was run again after it broke. */
  try: number;
  status: AttemptStatus;
  startedAt: string;
  durationMs: number | null;
  params: Record<string, ParamValue>;
}

export interface RunSummary {
  id: string;
  packId: string;
  packName: string;
  siteKey: string;
  /** The job kind (`test`, or one a plugin adds). */
  kind: string;
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
  /** Bytes the run's folder takes on the drive; null until measured (older servers leave it out). */
  sizeBytes?: number | null;
  counts: Record<AttemptStatus, number> & { planned: number };
}

export interface Attempt {
  id: string;
  /** The job kind (`test`, or one a plugin adds). */
  kind: string;
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
  /** The settings in effect, which POST /runs/:id/settings changes; null while the run sets up. */
  settings: RunSettings | null;
  /** Set once the drive ran low during the run; older servers leave it out. */
  storageLow?: { freeBytes: number; videosOff: boolean } | null;
}

/** GET /storage: what runs take on the drive. */
export interface StorageReport {
  dataDir: string;
  freeBytes: number | null;
  totalBytes: number | null;
  runs: number;
  runsBytes: number;
  unmeasured: number;
  largest: RunSummary[];
  limits: { warnBelowGB: number; stopBelowGB: number };
}

export type VideoQuality = "full" | "compact" | "small";

/** A Compress kept videos job, going or the last one. */
export interface CompressJob {
  state: "running" | "done" | "stopped" | "failed";
  quality: VideoQuality;
  total: number;
  done: number;
  kept: number;
  failed: number;
  beforeBytes: number;
  afterBytes: number;
  startedAt: string;
  finishedAt: string | null;
  reason: string | null;
  by: string;
}

/** The videos ended runs kept, and how many Compress kept videos would make smaller. */
export interface VideoReport {
  quality: VideoQuality;
  ffmpeg: boolean;
  videos: number;
  bytes: number;
  toCompress: number;
  toCompressBytes: number;
  job: CompressJob | null;
}

/** What cleanup deletes now under the keep rules (0 turns a rule off): the runs, oldest first, and their room. */
export interface CleanupPlan {
  rules: { keepDays: number; keepPerPack: number };
  runs: RunSummary[];
  bytes: number;
  unmeasured: number;
}

export interface RunSettings {
  pauseOnBroken: boolean;
  pauseLimitMinutes: number;
  /** The run's limit for every attempt; null when each test's own holds. */
  testTimeoutMinutes: number | null;
  trace: "problems" | "always" | "never";
  video: VideoMode;
  runVideo: boolean;
}

export interface RunDetail extends RunSummary {
  plan: { testId: string; title: string; number: number; of: number; children?: string[]; skip?: boolean; status: AttemptStatus | "pending"; attemptId: string | null }[];
  attempts: Attempt[];
  live: LiveSnapshot | null;
  /** Videos of the whole run, in parts; older servers leave it out. */
  runVideos?: { path: string; url: string; size: number }[];
}

/** A run as a share link or the public dashboard shows it: no live view, files from the share's own address. */
export interface SharedRun extends Pick<RunDetail, "id" | "packName" | "label" | "status" | "startedBy" | "createdAt" | "startedAt" | "finishedAt" | "error" | "params" | "info" | "counts" | "plan" | "attempts"> {
  /** Still running: the page asks again now and then. */
  running: boolean;
  runVideos: { url: string; size: number }[];
  /** Traces and collector files are shared too. */
  traces: boolean;
  /** The pack's public dashboard tiles for this one run; null without a dashboard. */
  tiles: TileGroupResult[] | null;
}

/** One attempt as a share shows it: its reviews come along (reviewers anonymous unless the share names them). */
export interface SharedAttempt extends ResultDocument {
  reviews: { criteria: Criterion[]; list: { reviewer: string; scores: Record<string, Score>; note: string; updatedAt: string }[] } | null;
}

/** A share link (`GET /shares`); the token itself is shown only once, when it is made. */
/** Who sees a pack besides the admins (docs/plans/pack-access.md): everyone, or chosen people (user ids) and groups. */
export type PackAccess = { mode: "everyone" } | { mode: "chosen"; people: string[]; groups: string[]; updatedBy: string; updatedAt: string };

/** A user as Admin › Users lists them. */
export interface UserInfo {
  id: string;
  name: string;
  displayName: string | null;
  role: "viewer" | "user" | "admin";
  source: "local" | "oidc" | "header";
  disabled: boolean;
  hasPassword: boolean;
  groups: string[];
  ssoGroups: string[];
  createdAt: string;
  seenAt: string | null;
}

export interface ShareLink {
  id: string;
  /** The page to open (`#/s/<token>`), to copy again; null for links made before links were kept. */
  page: string | null;
  runId: string;
  traces: boolean;
  /** Reviewers show by name, not as "Reviewer 1". */
  names: boolean;
  createdBy: string | null;
  createdAt: string;
  expiresAt: string | null;
  views: number;
  viewedAt: string | null;
  run: { packName: string; label: string; status: RunStatus; createdAt: string } | null;
}

/** The public dashboard's settings (`GET /shares/dashboard`, admins). */
export interface DashboardSettings {
  on: boolean;
  packs: string[];
  linkRuns: boolean;
  title: string;
  /** Each pack shows its dashboard's public tiles. */
  tiles: boolean;
}

/** The public dashboard (`GET /public/status`): each pack's latest runs, newest first. */
export interface PublicStatus {
  title: string;
  linkRuns: boolean;
  packs: { packId: string; name: string; runs: { id: string; label: string; status: RunStatus; counts: RunSummary["counts"]; startedAt: string | null; finishedAt: string | null; durationMs: number | null }[]; tiles: TileGroupResult[] | null }[];
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
  kind: string;
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
  /** Kept texts, collector records and saved files; `at` is the path inside the attempt folder. */
  files: { name: string; url: string; path: string; at: string }[];
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

let signedOutHandler: (() => void) | null = null;
/** Called when the server answers 401 `sign_in_needed` (login on, and the sign-in ran out). */
export function onSignedOut(handler: () => void): void {
  signedOutHandler = handler;
}

async function call<T>(url: string, init: RequestInit, fetcher: typeof fetch): Promise<ApiResult<T>> {
  try {
    const res = await fetcher(url, init);
    const body = (await res.json().catch(() => null)) as { data?: T; error?: ApiError } | null;
    if (res.status === 401 && body?.error?.code === "sign_in_needed") signedOutHandler?.();
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

/** POST a file as the request body (a pack .zip), with its type. */
export function sendFile<T>(url: string, file: Blob, type = "application/zip", fetcher: typeof fetch = fetch): Promise<ApiResult<T>> {
  return call<T>(url, { method: "POST", headers: { accept: "application/json", "content-type": type, "x-watchwright-client": "web" }, body: file }, fetcher);
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
