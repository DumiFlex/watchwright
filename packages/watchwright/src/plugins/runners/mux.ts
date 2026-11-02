import type net from "node:net";
import { CREDIT, DATA, END, encode, WINDOW, type Frame } from "./protocol.js";

// Carries TCP connections over one WebSocket, both ends alike (the server for a run's browser, the
// runner for the site on its machine). Each stream sends at most WINDOW bytes the other end hasn't
// taken yet: past that its socket pauses until CREDIT comes back, so a slow site or browser
// never fills the server's memory.

interface Stream {
  socket: net.Socket;
  /** Bytes sent the other end hasn't credited yet. */
  inFlight: number;
  /** We sent END (our socket ended). */
  sentEnd: boolean;
}

export class Mux {
  private readonly streams = new Map<number, Stream>();

  constructor(private readonly send: (frame: Buffer) => void) {}

  get size(): number {
    return this.streams.size;
  }

  has(id: number): boolean {
    return this.streams.has(id);
  }

  /** Starts carrying `socket` as stream `id`; it resumes reading if it was paused. */
  attach(id: number, socket: net.Socket): void {
    const s: Stream = { socket, inFlight: 0, sentEnd: false };
    this.streams.set(id, s);
    const end = () => {
      if (s.sentEnd) return;
      s.sentEnd = true;
      this.send(encode(END, id));
    };
    socket.on("data", (chunk: Buffer) => {
      if (this.streams.get(id) !== s) return;
      this.send(encode(DATA, id, chunk));
      s.inFlight += chunk.length;
      if (s.inFlight >= WINDOW) socket.pause();
    });
    socket.on("end", end);
    socket.on("error", () => undefined);
    socket.on("close", () => {
      end();
      if (this.streams.get(id) === s) this.streams.delete(id);
    });
    socket.resume();
  }

  /** A frame from the other end; false when it isn't for a stream this mux carries. */
  handle(f: Frame): boolean {
    const s = this.streams.get(f.stream);
    if (!s) return false;
    if (f.type === DATA) {
      const n = f.payload.length;
      s.socket.write(f.payload, () => {
        if (this.streams.get(f.stream) === s) {
          const p = Buffer.alloc(4);
          p.writeUInt32BE(n);
          this.send(encode(CREDIT, f.stream, p));
        }
      });
    } else if (f.type === CREDIT && f.payload.length >= 4) {
      s.inFlight = Math.max(0, s.inFlight - f.payload.readUInt32BE(0));
      if (s.inFlight < WINDOW && s.socket.isPaused()) s.socket.resume();
    } else if (f.type === END) {
      s.socket.end();
      if (s.sentEnd) this.streams.delete(f.stream);
    } else return false;
    return true;
  }

  /** Drops every stream (the WebSocket closed). */
  closeAll(): void {
    for (const s of this.streams.values()) s.socket.destroy();
    this.streams.clear();
  }
}
