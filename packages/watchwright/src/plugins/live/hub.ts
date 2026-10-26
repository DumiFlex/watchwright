import { serviceKey } from "../../core/services.js";

// Screencast frames go from the browser session to every viewer of a run. Frames are never
// stored: the hub keeps only the newest frame per page for viewers that join late.

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

  publish(frame: Frame): void {
    let pages = this.latest.get(frame.runId);
    if (!pages) this.latest.set(frame.runId, (pages = new Map()));
    pages.set(frame.pageId, frame);
    for (const fn of this.listeners.get(frame.runId) ?? []) fn(frame);
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

  /** Drops a page's frame when it closes, or every frame of a run when it ends. */
  forget(runId: string, pageId?: string): void {
    if (pageId === undefined) this.latest.delete(runId);
    else this.latest.get(runId)?.delete(pageId);
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
