// Small text formats the pages share: durations, times and run counts.
import type { RunSummary } from "./api";

/** "850 ms", "4.2 s", "3 min 5 s", "2 h 4 min". */
export function duration(ms: number | null): string {
  if (ms === null) return "";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const s = Math.round(ms / 1000);
  if (s < 3600) return `${Math.floor(s / 60)} min ${s % 60} s`;
  const m = Math.round(s / 60);
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** A run's wall time: from start to finish, or to `now` when given (a run that is going). Null when unknown. */
export function runDuration(r: Pick<RunSummary, "startedAt" | "finishedAt">, now?: number): number | null {
  if (!r.startedAt) return null;
  if (r.finishedAt) return Date.parse(r.finishedAt) - Date.parse(r.startedAt);
  return now === undefined ? null : now - Date.parse(r.startedAt);
}

/** "just now", "5 min ago", "3 h ago", "yesterday", then the date. */
export function ago(iso: string, now = Date.now()): string {
  const s = Math.round((now - Date.parse(iso)) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  if (s < 2 * 86_400) return "yesterday";
  return new Date(iso).toLocaleDateString();
}

/** "in 5 min", "in 3 h", "tomorrow 09:00", then the date and time: when something is due. */
export function soon(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  const s = Math.round((t - now) / 1000);
  if (s < 45) return "any moment";
  if (s < 3600) return `in ${Math.max(1, Math.round(s / 60))} min`;
  const d = new Date(t);
  const hm = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(d) - day(new Date(now))) / 86_400_000);
  if (days === 0) return `today ${hm}`;
  if (days === 1) return `tomorrow ${hm}`;
  return `${d.toLocaleDateString()} ${hm}`;
}

export function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : "–";
}

/** "3 passed, 1 broken of 5". */
export function countsText(c: RunSummary["counts"]): string {
  const parts = [`${c.passed} passed`];
  if (c.failed) parts.push(`${c.failed} failed`);
  if (c.broken) parts.push(`${c.broken} broken`);
  if (c.skipped) parts.push(`${c.skipped} skipped`);
  if (c.stopped) parts.push(`${c.stopped} stopped`);
  return `${parts.join(", ")} of ${c.planned}`;
}

/** Decided attempts out of planned ones, for progress bars. */
export function done(c: RunSummary["counts"]): number {
  return c.passed + c.failed + c.broken + c.skipped + c.stopped;
}

export const ACTIVE = ["queued", "running", "pausing", "paused"] as const;
export const isActive = (status: string) => (ACTIVE as readonly string[]).includes(status);

/** A position in a video: "0:07", "12:34", "1:02:03". */
export function clockTime(seconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** A file size: "820 B", "12 KB", "3.4 MB". */
export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
