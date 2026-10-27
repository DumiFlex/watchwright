import type { WebSocket } from "ws";
import { defineAction } from "../../actions/registry.js";
import { definePlugin } from "../../core/plugin.js";
import { matches, type EventFilter, type WwEvent } from "../../events/log.js";
import { errorBody } from "../../server/errors.js";
import { VERSION } from "../../version.js";
import { encodeFrame, FrameHub, FRAMES, REWIND_MS, type Frame } from "./hub.js";

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
  actions({ services }) {
    const hub = services.get(FRAMES);
    return [
      defineAction<{ runId: string }>({
        name: "live.rewind",
        title: "What the live view showed in the last 30 s of a run that is going: one entry per kept frame (at most 5 a second per page)",
        method: "GET",
        path: "/live/:runId/rewind",
        input: { type: "object", properties: { runId: { type: "string", pattern: "^[0-9a-f]{8}$" } }, required: ["runId"] },
        handler: ({ runId }) => ({
          windowMs: REWIND_MS,
          frames: hub.history(runId).map((f) => ({ pageId: f.pageId, timestamp: f.timestamp, width: f.width, height: f.height, url: `/api/v1/live/${runId}/rewind/${f.pageId}/${f.timestamp}.jpg` })),
        }),
      }),
    ];
  },
  routes(app, { events, services }) {
    const hub = services.get(FRAMES);
    const RUN = /^[0-9a-f]{8}$/;
    // A frame of the rewind buffer as a JPEG (the index is the `live.rewind` action).
    app.get<{ Params: { runId: string; pageId: string; timestamp: string } }>("/live/:runId/rewind/:pageId/:timestamp", async (req, reply) => {
      const { runId, pageId, timestamp } = req.params;
      const at = Number(timestamp.replace(/\.jpg$/, ""));
      if (!RUN.test(runId) || !Number.isFinite(at)) return reply.code(400).send(errorBody("bad_input", "Ask for /live/<run>/rewind/<page>/<timestamp>.jpg."));
      const frame = hub.frameAt(runId, pageId, at);
      if (!frame) return reply.code(404).send(errorBody("not_found", "That moment is no longer in the rewind buffer."));
      return reply.header("content-type", "image/jpeg").header("cache-control", "private, max-age=60").header("x-frame-timestamp", String(frame.timestamp)).send(frame.data);
    });
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
