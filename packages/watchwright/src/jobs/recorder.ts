import { mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

// Collects what one attempt produces: artifact files in its folder, log lines, notes, flags,
// metrics and kept texts. The engine turns it into rows and result.json when the attempt ends.

export interface ArtifactInfo {
  kind: string;
  name: string;
  contentType: string;
  /** Path relative to the data folder, with forward slashes. */
  path: string;
  size: number;
  /** Shots taken as one set (a scroll-shot series) share the set's name, in order. */
  set?: string;
}

/** A named step (`h.step`) with when it ran; `depth` is 0 for a top-level step, 1 inside one, … */
export interface StepRecord {
  title: string;
  depth: number;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "passed" | "failed";
}

export interface LogLine {
  time: string;
  level: "info" | "warn" | "error";
  message: string;
}

export interface FlagRecord {
  name: string;
  kind: "robot" | "finding" | "info";
  detail: string | null;
  declared: boolean;
}

export interface MetricRecord {
  value: number;
  unit: string | null;
}

const TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json",
  ".md": "text/markdown; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
  ".yaml": "text/yaml; charset=utf-8",
  ".yml": "text/yaml; charset=utf-8",
  ".xml": "application/xml",
  ".pdf": "application/pdf",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".webm": "video/webm",
  ".zip": "application/zip",
  ".html": "text/html; charset=utf-8",
};

export function contentTypeOf(file: string): string {
  return TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}

/** A relative path inside a folder (`a/b.md`), or null when it would leave it or isn't a usable name. */
export function safeRelative(name: string): string | null {
  const parts = name.split(/[\\/]+/).filter((p) => p !== "" && p !== ".");
  if (parts.length === 0 || parts.some((p) => p === ".." || /[:<>|?*"]/.test(p))) return null;
  return parts.join("/");
}

/** File-name-safe version of a label: `Search results` → `search-results`. */
export function slug(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return s || "item";
}

export class AttemptRecorder {
  readonly artifacts: ArtifactInfo[] = [];
  readonly log: LogLine[] = [];
  readonly notes: string[] = [];
  readonly flags: FlagRecord[] = [];
  readonly metrics: Record<string, MetricRecord> = {};
  readonly texts: Record<string, string> = {};
  readonly steps: StepRecord[] = [];
  private counter = 0;

  constructor(
    /** Absolute folder of this attempt. */
    readonly dir: string,
    /** The data folder, to make artifact paths relative. */
    private readonly dataDir: string,
    private readonly onArtifact: (a: ArtifactInfo) => void = () => undefined,
    private readonly onLog: (l: LogLine) => void = () => undefined,
  ) {
    mkdirSync(dir, { recursive: true });
  }

  /** `01-home.png`, `02-results.txt`, … in the order things were saved. */
  numberedName(name: string, ext: string): string {
    this.counter++;
    return `${String(this.counter).padStart(2, "0")}-${slug(name)}${ext}`;
  }

  /** Registers a file already written inside the attempt folder (or anywhere under the data folder). */
  register(kind: string, name: string, absPath: string, contentType = contentTypeOf(absPath), extra: { set?: string } = {}): ArtifactInfo {
    const info: ArtifactInfo = {
      kind,
      name,
      contentType,
      path: path.relative(this.dataDir, absPath).split(path.sep).join("/"),
      size: statSync(absPath).size,
      ...(extra.set !== undefined ? { set: extra.set } : {}),
    };
    this.artifacts.push(info);
    this.onArtifact(info);
    return info;
  }

  write(kind: string, name: string, fileName: string, data: string | Buffer, contentType?: string, extra: { set?: string } = {}): ArtifactInfo {
    const abs = path.join(this.dir, fileName);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, data);
    return this.register(kind, name, abs, contentType, extra);
  }

  beginStep(title: string, depth: number): StepRecord {
    const step: StepRecord = { title, depth, startedAt: new Date().toISOString(), finishedAt: null, status: "running" };
    this.steps.push(step);
    return step;
  }

  endStep(step: StepRecord, ok: boolean): void {
    step.finishedAt = new Date().toISOString();
    step.status = ok ? "passed" : "failed";
  }

  addLog(level: LogLine["level"], message: string): void {
    const line = { time: new Date().toISOString(), level, message };
    this.log.push(line);
    this.onLog(line);
  }
}
