import { decodeFrame, liveUrl, type FrameHeader, type WwEvent } from "./api";
import { canDecodeVideo, VideoPictures, wantsVideo } from "./livevideo";
import { loadSettings, settings } from "./settings";

export type LiveState = "connecting" | "open" | "closed";

export interface LiveSubscription {
  runId?: string;
  frames?: boolean;
  /** Replay events after this sequence number (default: only new ones). */
  after?: number;
  /** With `runId`: of the replayed log lines, only the newest this many. */
  logTail?: number;
  /** With `frames`: a video stream when the person's `live.video` setting asks for one and this browser can decode it (else JPEG frames). */
  video?: boolean;
}

export interface LiveHandlers {
  onState?(state: LiveState): void;
  /** The server's newest event when the subscription began: events up to it are the replayed backlog. */
  onHello?(head: number): void;
  /** How many older log lines the server left out of the replay (with `logTail`). */
  onBacklog?(skippedLogs: number): void;
  onEvent?(event: WwEvent): void;
  /**
   * A page of the replayed backlog, oldest first. Without it each event goes to `onEvent`, all in
   * the same task, so the page renders once per batch and not once per line.
   */
  onEvents?(events: WwEvent[]): void;
  /** A JPEG frame, or a picture decoded from the video stream. */
  onFrame?(header: FrameHeader, picture: Uint8Array | ImageBitmap): void;
  /** Whether frames come as a video stream (after a subscription that asked for one). */
  onStream?(video: boolean): void;
}

/** The live WebSocket with automatic reconnect. On reconnect it resubscribes from the last event it saw. */
export class LiveConnection {
  private socket: WebSocket | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private retryMs = 1000;
  private closed = false;
  private lastSeq: number | null = null;
  private readonly pictures = new VideoPictures((h, bitmap) => this.handlers.onFrame?.(h, bitmap));

  constructor(
    private sub: LiveSubscription,
    private readonly handlers: LiveHandlers,
  ) {
    this.connect();
  }

  private connect() {
    this.handlers.onState?.("connecting");
    const socket = new WebSocket(liveUrl(window.location));
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    socket.onopen = () => {
      this.retryMs = 1000;
      this.handlers.onState?.("open");
      this.send();
    };
    socket.onmessage = (msg: MessageEvent<ArrayBuffer | string>) => {
      if (typeof msg.data !== "string") {
        const { header, jpeg } = decodeFrame(msg.data);
        if (header.video) this.pictures.push(header, jpeg);
        else this.handlers.onFrame?.(header, jpeg);
        return;
      }
      const parsed = JSON.parse(msg.data) as { type: string; data: WwEvent };
      if (parsed.type === "stream") {
        this.handlers.onStream?.((parsed.data as unknown as { video?: unknown }).video === "vp8");
        return;
      }
      if (parsed.type === "hello") {
        const head = (parsed.data as unknown as { head?: unknown }).head;
        if (typeof head === "number") this.handlers.onHello?.(head);
        return;
      }
      if (parsed.type === "backlog") {
        const skipped = (parsed.data as unknown as { skippedLogs?: unknown }).skippedLogs;
        if (typeof skipped === "number") this.handlers.onBacklog?.(skipped);
        return;
      }
      if (parsed.type === "events") {
        const list = parsed.data as unknown as WwEvent[];
        if (!Array.isArray(list) || list.length === 0) return;
        this.lastSeq = list[list.length - 1]!.seq;
        if (this.handlers.onEvents) this.handlers.onEvents(list);
        else for (const e of list) this.handlers.onEvent?.(e);
        return;
      }
      if (parsed.type !== "event") return;
      this.lastSeq = parsed.data.seq;
      this.handlers.onEvent?.(parsed.data);
    };
    socket.onclose = () => {
      this.handlers.onState?.("closed");
      if (this.closed) return;
      this.retry = setTimeout(() => this.connect(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, 15000);
    };
  }

  private send() {
    const socket = this.socket;
    if (socket?.readyState !== WebSocket.OPEN) return;
    const ask = (video: boolean) => {
      if (socket !== this.socket || socket.readyState !== WebSocket.OPEN) return;
      const after = this.lastSeq ?? this.sub.after;
      this.pictures.clear();
      socket.send(JSON.stringify({ type: "subscribe", runId: this.sub.runId ?? null, frames: this.sub.frames ?? false, batch: true, ...(after === undefined ? {} : { after }), ...(this.sub.logTail ? { logTail: this.sub.logTail } : {}), ...(video ? { video: "vp8" } : {}) }));
      if (this.sub.frames && !video) this.handlers.onStream?.(false);
    };
    if (this.sub.frames && this.sub.video) {
      void Promise.all([loadSettings().catch(() => undefined), canDecodeVideo()]).then(([, can]) => ask(can && wantsVideo(settings.values["live.video"], window.location.hostname)));
    }
    else ask(false);
  }

  close() {
    this.closed = true;
    this.pictures.clear();
    if (this.retry) clearTimeout(this.retry);
    this.socket?.close();
  }
}
