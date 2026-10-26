import type { WebSocket } from "ws";
import { definePlugin } from "../../core/plugin.js";
import { matches, type EventFilter, type WwEvent } from "../../events/log.js";
import { VERSION } from "../../version.js";
import { encodeFrame, FrameHub, FRAMES, type Frame } from "./hub.js";

/** A viewer with more than this queued on its socket skips frames until it drains. */
export const FRAME_BACKLOG_BYTES = 1024 * 1024;

interface Subscribe {
  type: "subscribe";
  /** Send events with a sequence number above this first (default: only new events). */
  after?: number;
  /** Only this run's events (plus events that belong to no run), and its frames when `frames` is on. */
  runId?: string | null;
  frames?: boolean;
}

function parse(raw: unknown): Subscribe | null {
  try {
    const msg = JSON.parse(String(raw)) as Partial<Subscribe>;
    if (msg.type !== "subscribe") return null;
    return msg as Subscribe;
  } catch {
    return null;
  }
}

/**
 * The live channel. A client sends `{ type: "subscribe", after?, runId?, frames? }` (again to
 * change it) and gets JSON text messages `{ type: "event", data }` plus binary frame messages.
 */
export const livePlugin = definePlugin({
  name: "live",
  setup({ services }) {
    services.provide(FRAMES, new FrameHub());
  },
  routes(app, { events, services }) {
    const hub = services.get(FRAMES);
    app.get("/live", { websocket: true }, (socket: WebSocket) => {
      let stopEvents: (() => void) | null = null;
      let stopFrames: (() => void) | null = null;
      let drainTimer: ReturnType<typeof setInterval> | null = null;
      const pending = new Map<string, Frame>();

      const sendEvent = (e: WwEvent) => socket.send(JSON.stringify({ type: "event", data: e }));
      const flush = () => {
        if (socket.bufferedAmount > FRAME_BACKLOG_BYTES) return;
        for (const [id, f] of pending) {
          pending.delete(id);
          socket.send(encodeFrame(f));
        }
        if (pending.size === 0 && drainTimer) {
          clearInterval(drainTimer);
          drainTimer = null;
        }
      };
      const sendFrame = (f: Frame) => {
        pending.set(f.pageId, f); // only the newest frame per page ever waits
        if (socket.bufferedAmount <= FRAME_BACKLOG_BYTES) flush();
        else if (!drainTimer) drainTimer = setInterval(flush, 50);
      };
      const stop = () => {
        stopEvents?.();
        stopFrames?.();
        stopEvents = stopFrames = null;
        if (drainTimer) clearInterval(drainTimer);
        drainTimer = null;
        pending.clear();
      };

      socket.send(JSON.stringify({ type: "hello", data: { version: VERSION, head: events.head() } }));
      socket.on("message", (raw: unknown, isBinary: boolean) => {
        const msg = isBinary ? null : parse(raw);
        if (!msg) {
          socket.send(JSON.stringify({ type: "error", data: { code: "bad_message", message: 'Send {"type":"subscribe", …} as JSON.' } }));
          return;
        }
        stop();
        const filter: EventFilter = { runId: msg.runId ?? undefined };
        // Backlog and live listener are attached in one synchronous pass, so no event is missed or sent twice.
        let last = msg.after ?? events.head();
        for (;;) {
          const page = events.after(last, filter, 1000);
          for (const e of page) sendEvent(e);
          if (page.length > 0) last = page[page.length - 1]!.seq;
          if (page.length < 1000) break;
        }
        stopEvents = events.subscribe((e) => {
          if (e.seq <= last || !matches(e, filter)) return;
          last = e.seq;
          sendEvent(e);
        });
        if (msg.frames && msg.runId) {
          for (const f of hub.latestFrames(msg.runId)) sendFrame(f);
          stopFrames = hub.subscribe(msg.runId, sendFrame);
        }
      });
      socket.on("close", stop);
    });
  },
});
