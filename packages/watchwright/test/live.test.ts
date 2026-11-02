import { afterEach, expect, it } from "vitest";
import WebSocket from "ws";
import { cleanTempDirs, tempDir } from "./helpers/fixtures.js";
import { startHarness, type Harness } from "./helpers/harness.js";

const harnesses: Harness[] = [];
afterEach(async () => {
  for (const h of harnesses.splice(0)) await h.close();
  cleanTempDirs();
});

/** Subscribes, then collects text messages until `done` says the backlog is in. */
async function collect(h: Harness, sub: Record<string, unknown>, done: (msgs: { type: string; data: Record<string, unknown> }[]) => boolean) {
  const ws = new WebSocket(`ws://${h.host}/api/v1/live`, { headers: { origin: `http://${h.host}` } });
  const msgs: { type: string; data: Record<string, unknown> }[] = [];
  await new Promise<void>((resolve, reject) => {
    ws.on("message", (data: Buffer, isBinary: boolean) => {
      if (isBinary) return;
      const msg = JSON.parse(String(data)) as { type: string; data: Record<string, unknown> };
      if (msg.type === "hello") ws.send(JSON.stringify({ type: "subscribe", ...sub }));
      else msgs.push(msg);
      if (done(msgs)) resolve();
    });
    ws.once("error", reject);
  });
  ws.close();
  return msgs;
}

it("sends only the newest log lines of a run's backlog, and says how many it skipped", async () => {
  const h = await startHarness(tempDir("ww-data-"), { listen: true });
  harnesses.push(h);
  const events = h.app.watchwright.events;
  const runId = "1a2b3c4d";
  events.append("run.started", {}, { runId });
  for (let i = 0; i < 20; i++) events.append("attempt.log", { message: `line ${i}` }, { runId });
  const finished = events.append("run.finished", {}, { runId });
  const isLast = (m: { type: string; data: Record<string, unknown> }) => m.type === "event" && m.data.seq === finished.seq;

  const tail = await collect(h, { runId, after: 0, logTail: 5 }, (msgs) => msgs.some(isLast));
  expect(tail[0]).toEqual({ type: "backlog", data: { skippedLogs: 15 } });
  const sent = tail.filter((m) => m.type === "event").map((m) => m.data);
  expect(sent.map((e) => e.type)).toEqual(["run.started", ...Array(5).fill("attempt.log"), "run.finished"]);
  expect(sent.filter((e) => e.type === "attempt.log").map((e) => (e.data as { message: string }).message)).toEqual(["line 15", "line 16", "line 17", "line 18", "line 19"]);

  const all = await collect(h, { runId, after: 0 }, (msgs) => msgs.some(isLast));
  expect(all.some((m) => m.type === "backlog")).toBe(false);
  expect(all.filter((m) => m.type === "event")).toHaveLength(22);
});

it("sends the backlog in batches with `batch`, and the newest frame before it", async () => {
  const h = await startHarness(tempDir("ww-data-"), { listen: true });
  harnesses.push(h);
  const events = h.app.watchwright.events;
  const { FRAMES } = await import("../src/plugins/live/hub.js");
  const runId = "5e6f7a8b";
  h.app.watchwright.services.get(FRAMES).publish({ runId, pageId: "p1", timestamp: Date.now(), width: 2, height: 2, data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) });
  events.append("run.started", {}, { runId });
  for (let i = 0; i < 2500; i++) events.append("attempt.log", { message: `line ${i}` }, { runId });
  const finished = events.append("run.finished", {}, { runId });

  const ws = new WebSocket(`ws://${h.host}/api/v1/live`, { headers: { origin: `http://${h.host}` } });
  const order: string[] = [];
  const batches: { seq: number }[][] = [];
  await new Promise<void>((resolve, reject) => {
    ws.on("message", (data: Buffer, isBinary: boolean) => {
      if (isBinary) return void order.push("frame");
      const msg = JSON.parse(String(data)) as { type: string; data: unknown };
      if (msg.type === "hello") return void ws.send(JSON.stringify({ type: "subscribe", runId, after: 0, frames: true, logTail: 2000, batch: true }));
      order.push(msg.type);
      if (msg.type === "events") batches.push(msg.data as { seq: number }[]);
      if (batches.flat().some((e) => e.seq === finished.seq)) resolve();
    });
    ws.once("error", reject);
  });
  ws.close();
  expect(order[0]).toBe("frame");
  expect(order.filter((t) => t === "event")).toHaveLength(0);
  expect(batches.length).toBeGreaterThan(1);
  expect(batches.every((b) => b.length <= 1000)).toBe(true);
  // run.started, the newest 2000 lines, run.finished
  expect(batches.flat()).toHaveLength(2002);
});
