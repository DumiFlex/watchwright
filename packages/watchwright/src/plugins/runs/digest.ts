import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import type { EventLog, WwEvent } from "../../events/log.js";
import { contentTypeOf } from "../../jobs/recorder.js";
import type { Engine, LiveSnapshot, RunDetail } from "./engine.js";
import { ACTIVE_STATUSES, type AttemptStatus } from "./repo.js";
import { fileUrl } from "./results.js";

// What agents read about a run: a short summary instead of the full run document, a bounded wait
// that says what happened meanwhile, and one result file with its bytes (docs/plans/step-5.md, section 2).

export interface AttemptDigest {
  id: string;
  testId: string;
  title: string;
  number: number;
  try: number;
  parentId: string | null;
  status: AttemptStatus;
  /** The error's kind and first line. */
  error: string | null;
  /** Flags by kind: robot problems (the test went wrong) and findings (the site did). */
  robot: number;
  findings: number;
  durationMs: number | null;
}

export interface RunDigest {
  id: string;
  label: string;
  pack: { id: string; name: string };
  status: string;
  startedBy: string;
  /** The run's page in the web app, after the server's address. */
  page: string;
  live: (Pick<LiveSnapshot, "state" | "pauseReason" | "pausedBy" | "deadline" | "stopping" | "testId" | "step">) | null;
  counts: Record<string, number>;
  /** Planned attempts that haven't started. */
  pending: number;
  attempts: AttemptDigest[];
  error: string | null;
}

export function digest(run: RunDetail): RunDigest {
  const firstLine = (s: string) => s.split("\n")[0]!.slice(0, 300);
  return {
    id: run.id,
    label: run.label,
    pack: { id: run.packId, name: run.packName },
    status: run.status,
    startedBy: run.startedBy,
    page: `/#/runs/${run.id}`,
    // An ended run's live state can linger a moment while the engine tears it down.
    live: run.live && (ACTIVE_STATUSES as readonly string[]).includes(run.status)
      ? { state: run.live.state, pauseReason: run.live.pauseReason, pausedBy: run.live.pausedBy, deadline: run.live.deadline, stopping: run.live.stopping, testId: run.live.testId, step: run.live.step }
      : null,
    counts: Object.fromEntries(Object.entries(run.counts).filter(([, n]) => n > 0)),
    pending: run.plan.filter((p) => p.status === "pending").length,
    attempts: run.attempts.map((a) => ({
      id: a.id,
      testId: a.testId,
      title: a.title,
      number: a.number,
      try: a.try,
      parentId: a.parentId,
      status: a.status,
      error: a.error ? `${a.error.kind}: ${firstLine(a.error.message)}` : null,
      robot: a.flags.filter((f) => f.kind === "robot").length,
      findings: a.flags.filter((f) => f.kind === "finding").length,
      durationMs: a.durationMs,
    })),
    error: run.error,
  };
}

/** One thing that happened in a run, as a wait reports it. */
export interface Happening {
  seq: number;
  time: string;
  type: string;
  [key: string]: unknown;
}

const REPORTED = new Set(["run.started", "attempt.finished", "run.paused", "run.resumed", "run.stopping", "run.finished", "run.interrupted"]);

function happening(e: WwEvent): Happening | null {
  if (!REPORTED.has(e.type)) return null;
  const d = e.data;
  const keep = (...keys: string[]) => Object.fromEntries(keys.filter((k) => d[k] !== undefined && d[k] !== null).map((k) => [k, d[k]]));
  const base = { seq: e.seq, time: e.time, type: e.type };
  switch (e.type) {
    case "attempt.finished":
      return { ...base, attemptId: e.attemptId, ...keep("testId", "number", "try", "status", "error", "flags", "parentId") };
    case "run.paused":
      return { ...base, ...keep("reason", "testId", "by", "deadline") };
    case "run.stopping":
      return { ...base, ...keep("when") };
    case "run.finished":
      return { ...base, ...keep("status") };
    case "run.interrupted":
      return { ...base, ...keep("reason", "message") };
    default:
      return base;
  }
}

export type WaitReason = "ended" | "paused" | "timeout" | "gone";

export interface WaitResult {
  /** Why the wait returned: the run ended, paused (needs an answer), the time ran out, or the caller went away. */
  reason: WaitReason;
  /** Pass as `after` to the next wait. */
  cursor: number;
  happened: Happening[];
  run: RunDigest;
}

const MAX_HAPPENED = 100;

/**
 * Waits until the run ends or pauses, at most `timeoutMs`. Without `after`, a run that is paused
 * now returns at once; with it, only a pause after that cursor counts, so a caller waiting while a
 * person keeps a run paused isn't answered again and again.
 */
export async function waitForRun(engine: Engine, events: EventLog, id: string, after: number | undefined, timeoutMs: number, signal: AbortSignal): Promise<WaitResult | null> {
  if (!engine.get(id)) return null;
  const end = Date.now() + timeoutMs;
  let cursor = after ?? events.head();
  let pausedSince = after === undefined;
  const happened: Happening[] = [];
  const take = (list: WwEvent[]) => {
    for (const e of list) {
      if (e.seq <= cursor) continue;
      cursor = e.seq;
      if (e.type === "run.paused") pausedSince = true;
      if (e.type === "run.resumed") pausedSince = false;
      const h = happening(e);
      if (h) happened.push(h);
    }
    if (happened.length > MAX_HAPPENED) happened.splice(0, happened.length - MAX_HAPPENED);
  };
  for (;;) {
    // Everything logged so far, before reading the state: a pause logs right after the event that woke the wait.
    take(events.after(cursor, { runId: id }, 1000));
    const run = engine.get(id)!;
    const done = (reason: WaitReason): WaitResult => ({ reason, cursor, happened, run: digest(run) });
    if (!(ACTIVE_STATUSES as readonly string[]).includes(run.status) && run.status !== "queued") return done("ended");
    if (run.status === "paused" && pausedSince) return done("paused");
    if (signal.aborted) return done("gone");
    const left = end - Date.now();
    if (left <= 0) return done("timeout");
    await events.wait(cursor, left, { runId: id }, 1000, signal);
  }
}

export interface RunFile {
  path: string;
  url: string;
  mimeType: string;
  size: number;
  /** For PNG and JPEG images. */
  width?: number;
  height?: number;
  /** How `data` is written; null when the file isn't sent (too big, or not text or an image). */
  encoding: "utf8" | "base64" | null;
  data: string | null;
  /** Why `data` is null. */
  note?: string;
}

export const MAX_TEXT_BYTES = 1024 * 1024;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** Clients refuse images with a side longer than about this. */
export const MAX_IMAGE_SIDE = 8000;

/** Width and height of a PNG or JPEG from its header, or null. */
export function imageSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47 && buf.toString("ascii", 12, 16) === "IHDR") {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1]!;
      const len = buf.readUInt16BE(i + 2);
      // Start-of-frame markers carry the size; C4, C8 and CC are other tables.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
  }
  return null;
}

/** One of a run's files by its path relative to the data folder (`runs/<id>/…`, as results list them), or null when it isn't one. */
export function readRunFile(dataDir: string, runId: string, rel: string): RunFile | null {
  const clean = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!clean.startsWith(`runs/${runId}/`)) return null;
  const root = path.resolve(dataDir, "runs", runId);
  const abs = path.resolve(dataDir, ...clean.split("/"));
  if (!abs.startsWith(root + path.sep) || !existsSync(abs) || !statSync(abs).isFile()) return null;
  // A link inside the run folder must not lead out of it.
  if (!realpathSync(abs).startsWith(realpathSync(root) + path.sep)) return null;
  const size = statSync(abs).size;
  const mimeType = contentTypeOf(abs).split(";")[0]!;
  const base = { path: clean, url: fileUrl(clean), mimeType, size };
  if (mimeType === "image/png" || mimeType === "image/jpeg") {
    const buf = readFileSync(abs);
    const dims = imageSize(buf) ?? undefined;
    if (size > MAX_IMAGE_BYTES) return { ...base, ...dims, encoding: null, data: null, note: `The image is ${Math.round(size / 1024)} KB, more than clients take; open its url.` };
    if (dims && Math.max(dims.width, dims.height) > MAX_IMAGE_SIDE) return { ...base, ...dims, encoding: null, data: null, note: `The image is ${dims.width}×${dims.height} px, larger than clients take; open its url.` };
    return { ...base, ...dims, encoding: "base64", data: buf.toString("base64") };
  }
  if (mimeType.startsWith("text/") || mimeType === "application/json" || mimeType === "application/xml") {
    if (size > MAX_TEXT_BYTES) return { ...base, encoding: null, data: null, note: `The file is ${Math.round(size / 1024)} KB; open its url.` };
    return { ...base, encoding: "utf8", data: readFileSync(abs, "utf8") };
  }
  return { ...base, encoding: null, data: null, note: "Not a text file or an image; open its url." };
}
