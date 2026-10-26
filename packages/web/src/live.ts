import { decodeFrame, liveUrl, type FrameHeader, type WwEvent } from "./api";

export type LiveState = "connecting" | "open" | "closed";

export interface LiveSubscription {
  runId?: string;
  frames?: boolean;
  /** Replay events after this sequence number (default: only new ones). */
  after?: number;
}

export interface LiveHandlers {
  onState?(state: LiveState): void;
  onEvent?(event: WwEvent): void;
  onFrame?(header: FrameHeader, jpeg: Uint8Array): void;
}

/** The live WebSocket with automatic reconnect. On reconnect it resubscribes from the last event it saw. */
export class LiveConnection {
  private socket: WebSocket | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private retryMs = 1000;
  private closed = false;
  private lastSeq: number | null = null;

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
        this.handlers.onFrame?.(header, jpeg);
        return;
      }
      const parsed = JSON.parse(msg.data) as { type: string; data: WwEvent };
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
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    const after = this.lastSeq ?? this.sub.after;
    this.socket.send(JSON.stringify({ type: "subscribe", runId: this.sub.runId ?? null, frames: this.sub.frames ?? false, ...(after === undefined ? {} : { after }) }));
  }

  close() {
    this.closed = true;
    if (this.retry) clearTimeout(this.retry);
    this.socket?.close();
  }
}
