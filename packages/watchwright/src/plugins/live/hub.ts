import { serviceKey } from "../../core/services.js";

// Screencast frames go from the browser session to every viewer of a run. Frames are never
// written to disk: the hub keeps the newest frame per page for viewers that join late, and a
// short rewind buffer (the last 30 s, at most 5 frames a second per page) to look back at.

/** How far back the rewind buffer reaches. */
export const REWIND_MS = 30_000;
/** At most one kept frame per page in this many ms. */
export const REWIND_GAP_MS = 200;
/**
 * A frame stays fetchable this much longer than the window lists it, so a viewer that opened the
 * rewind list can still load its oldest frames while it looks.
 */
export const REWIND_GRACE_MS = 30_000;

export interface Frame {
  runId: string;
  /** Stable id of the page within its run (`p1`, `p2`, …). */
  pageId: string;
  /** Milliseconds since the epoch when the browser painted the frame. */
  timestamp: number;
  width: number;
  height: number;
  /** JPEG bytes. */
  data: Buffer;
}

export type FrameListener = (frame: Frame) => void;

export class FrameHub {
  private readonly latest = new Map<string, Map<string, Frame>>();
  private readonly listeners = new Map<string, Set<FrameListener>>();
  private readonly rewind = new Map<string, Frame[]>();

  publish(frame: Frame): void {
    let pages = this.latest.get(frame.runId);
    if (!pages) this.latest.set(frame.runId, (pages = new Map()));
    pages.set(frame.pageId, frame);
    this.keep(frame);
    for (const fn of this.listeners.get(frame.runId) ?? []) fn(frame);
  }

  private keep(frame: Frame): void {
    let kept = this.rewind.get(frame.runId);
    if (!kept) this.rewind.set(frame.runId, (kept = []));
    const prev = kept.findLast((f) => f.pageId === frame.pageId);
    if (prev && frame.timestamp - prev.timestamp < REWIND_GAP_MS) return;
    kept.push(frame);
    const from = frame.timestamp - REWIND_MS - REWIND_GRACE_MS;
    const drop = kept.findIndex((f) => f.timestamp >= from);
    if (drop > 0) kept.splice(0, drop);
  }

  /** The rewind buffer of a run: frames of the last 30 s (before its newest frame), oldest first. */
  history(runId: string): Frame[] {
    const kept = this.rewind.get(runId) ?? [];
    const newest = kept.at(-1)?.timestamp;
    return newest === undefined ? [] : kept.filter((f) => f.timestamp >= newest - REWIND_MS);
  }

  /** The kept frame of a page at `timestamp`, or the last one before it. */
  frameAt(runId: string, pageId: string, timestamp: number): Frame | null {
    return (this.rewind.get(runId) ?? []).findLast((f) => f.pageId === pageId && f.timestamp <= timestamp) ?? null;
  }

  /** The newest frame of each page of a run. */
  latestFrames(runId: string): Frame[] {
    return [...(this.latest.get(runId)?.values() ?? [])];
  }

  /** True when someone is watching the run (the engine can skip work for frames nobody sees). */
  watched(runId: string): boolean {
    return (this.listeners.get(runId)?.size ?? 0) > 0;
  }

  subscribe(runId: string, fn: FrameListener): () => void {
    let set = this.listeners.get(runId);
    if (!set) this.listeners.set(runId, (set = new Set()));
    set.add(fn);
    return () => {
      set.delete(fn);
      if (set.size === 0) this.listeners.delete(runId);
    };
  }

  /** Drops a page's newest frame when it closes (its rewind frames stay), or every frame of a run when it ends. */
  forget(runId: string, pageId?: string): void {
    if (pageId === undefined) {
      this.latest.delete(runId);
      this.rewind.delete(runId);
    } else this.latest.get(runId)?.delete(pageId);
  }
}

export const FRAMES = serviceKey<FrameHub>("live.frames");

/** Binary frame message: 4-byte big-endian header length, the JSON header, then the JPEG. */
export function encodeFrame(frame: Frame): Buffer {
  const header = Buffer.from(
    JSON.stringify({ runId: frame.runId, pageId: frame.pageId, timestamp: frame.timestamp, width: frame.width, height: frame.height }),
    "utf8",
  );
  const len = Buffer.alloc(4);
  len.writeUInt32BE(header.length, 0);
  return Buffer.concat([len, header, frame.data]);
}

export function decodeFrame(buf: Buffer): Frame {
  const len = buf.readUInt32BE(0);
  const header = JSON.parse(buf.subarray(4, 4 + len).toString("utf8")) as Omit<Frame, "data">;
  return { ...header, data: buf.subarray(4 + len) };
}
