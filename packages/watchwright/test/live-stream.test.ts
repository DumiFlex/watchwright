import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { chromium } from "playwright";
import WebSocket from "ws";
import { FRAMES, FrameHub } from "../src/plugins/live/hub.js";
import { PageStream, StreamHub, streamBitRate, streamFfmpeg, type VideoChunk } from "../src/plugins/live/stream.js";
import { isVp8Key, WebmReader, type WebmBlock } from "../src/plugins/live/webm.js";
import { cleanTempDirs, tempDir } from "./helpers/fixtures.js";
import { startHarness, type Harness } from "./helpers/harness.js";

/** An EBML element: id bytes, size (8-byte vint, or unknown), body. */
function el(id: number[], body: Buffer | null): Buffer {
  if (body === null) return Buffer.from([...id, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
  const size = Buffer.alloc(8);
  size.writeBigUInt64BE(BigInt(body.length));
  size[0] = 0x01;
  return Buffer.concat([Buffer.from(id), size, body]);
}
const block = (offset: number, data: number[]) => {
  const b = Buffer.alloc(4);
  b[0] = 0x81; // track 1
  b.writeInt16BE(offset, 1);
  b[3] = 0x80;
  return Buffer.concat([b, Buffer.from(data)]);
};

describe("the live WebM reader", () => {
  const stream = Buffer.concat([
    el([0x1a, 0x45, 0xdf, 0xa3], Buffer.from([0x42, 0x86, 0x81, 0x01])),
    el([0x18, 0x53, 0x80, 0x67], null).subarray(0, 12), // Segment of unknown size: only its header
    el([0x16, 0x54, 0xae, 0x6b], Buffer.from([1, 2, 3])), // Tracks, skipped
    el([0x1f, 0x43, 0xb6, 0x75], null),
    el([0xe7], Buffer.from([0x03, 0xe8])), // Timecode 1000
    el([0xa3], block(5, [0x10, 0x20])),
    el([0x1f, 0x43, 0xb6, 0x75], Buffer.concat([el([0xe7], Buffer.from([0x07, 0xd0])), el([0xa0], el([0xa1], block(-3, [0x31])))])),
  ]);

  it("finds every block with its time, however the stream is cut into chunks", () => {
    for (const cut of [1, 2, 3, 7, stream.length]) {
      const got: WebmBlock[] = [];
      const r = new WebmReader((b) => got.push(b));
      for (let i = 0; i < stream.length; i += cut) r.push(stream.subarray(i, i + cut));
      expect(got.map((b) => [b.ms, [...b.data]])).toEqual([
        [1005, [0x10, 0x20]],
        [1997, [0x31]],
      ]);
    }
  });

  it("tells VP8 key frames by their first bit", () => {
    expect(isVp8Key(Buffer.from([0x10]))).toBe(true);
    expect(isVp8Key(Buffer.from([0x31]))).toBe(false);
  });

  it("asks for about 2.5 Mbit/s a megapixel, between 1 and 6", () => {
    expect(streamBitRate(1280, 720)).toBe(2_304_000);
    expect(streamBitRate(320, 240)).toBe(1_000_000);
    expect(streamBitRate(3840, 2160)).toBe(6_000_000);
  });
});

const ffmpeg = streamFfmpeg();

describe.skipIf(!ffmpeg)("a real live video stream", () => {
  const jpegs: Buffer[] = [];
  const harnesses: Harness[] = [];
  beforeAll(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 160, height: 90 } });
    for (const color of ["red", "green", "blue", "white"]) {
      await page.setContent(`<body style="margin:0;background:${color}"></body>`);
      jpegs.push(await page.screenshot({ type: "jpeg", quality: 80 }));
    }
    await browser.close();
  }, 60_000);
  afterEach(async () => {
    for (const h of harnesses.splice(0)) await h.close();
    cleanTempDirs();
  });
  afterAll(() => cleanTempDirs());

  const frame = (i: number, at: number) => ({ runId: "aaaaaaaa", pageId: "p1", timestamp: at, width: 160, height: 90, data: jpegs[i % jpegs.length]! });

  it("encodes frames as they come, each chunk stamped with its frame's time, starting with a key frame", async () => {
    const got: VideoChunk[] = [];
    const s = new PageStream(ffmpeg!, "aaaaaaaa", "p1", (c) => got.push(c));
    const t0 = Date.now();
    for (let i = 0; i < 8; i++) {
      s.push(frame(i, t0 + i * 40));
      await new Promise((r) => setTimeout(r, 40));
    }
    for (let i = 0; i < 100 && got.length < 8; i++) await new Promise((r) => setTimeout(r, 50));
    s.close();
    expect(got.length).toBe(8);
    expect(got[0]!.key).toBe(true);
    expect(got.slice(1).every((c) => !c.key)).toBe(true);
    expect(got.map((c) => c.timestamp - t0)).toEqual([0, 40, 80, 120, 160, 200, 240, 280]);
    expect(got.every((c) => c.width === 160 && c.height === 90)).toBe(true);
  });

  it("starts a run's stream from the picture its pages show, and sends a late viewer the chunks since the key frame", async () => {
    const frames = new FrameHub();
    const t0 = Date.now();
    frames.publish(frame(0, t0));
    const hub = new StreamHub(frames, ffmpeg!);
    const first: VideoChunk[] = [];
    const stopFirst = hub.watch("aaaaaaaa", (c) => first.push(c));
    frames.publish(frame(1, t0 + 40));
    for (let i = 0; i < 100 && first.length < 2; i++) await new Promise((r) => setTimeout(r, 50));
    expect(first.map((c) => c.timestamp - t0)).toEqual([0, 40]);
    const late: VideoChunk[] = [];
    const stopLate = hub.watch("aaaaaaaa", (c) => late.push(c));
    expect(late.map((c) => [c.timestamp - t0, c.key])).toEqual([
      [0, true],
      [40, false],
    ]);
    stopFirst();
    stopLate();
    hub.close();
  });

  it("sends a viewer that asks for vp8 a video stream over the live socket", async () => {
    const h = await startHarness(tempDir("ww-data-"), { listen: true });
    harnesses.push(h);
    const frames = h.app.watchwright.services.get(FRAMES);
    const runId = "9a8b7c6d";
    const t0 = Date.now();
    frames.publish({ ...frame(0, t0), runId });
    const ws = new WebSocket(`ws://${h.host}/api/v1/live`, { headers: { origin: `http://${h.host}` } });
    const got = await new Promise<{ stream: unknown; header: Record<string, unknown> }>((resolve, reject) => {
      let stream: unknown = null;
      ws.on("message", (data: Buffer, isBinary: boolean) => {
        if (isBinary) {
          const len = data.readUInt32BE(0);
          resolve({ stream, header: JSON.parse(data.subarray(4, 4 + len).toString("utf8")) as Record<string, unknown> });
          return;
        }
        const msg = JSON.parse(String(data)) as { type: string; data: unknown };
        if (msg.type === "hello") ws.send(JSON.stringify({ type: "subscribe", runId, frames: true, video: "vp8" }));
        if (msg.type === "stream") stream = msg.data;
      });
      ws.once("error", reject);
    });
    ws.close();
    expect(got.stream).toEqual({ video: "vp8" });
    expect(got.header).toMatchObject({ runId, pageId: "p1", timestamp: t0, video: "vp8", key: true });
  });
});

it("says when a viewer asks for a codec the server doesn't stream", async () => {
  const h = await startHarness(tempDir("ww-data-"), { listen: true });
  try {
    const ws = new WebSocket(`ws://${h.host}/api/v1/live`, { headers: { origin: `http://${h.host}` } });
    const stream = await new Promise<unknown>((resolve, reject) => {
      ws.on("message", (data: Buffer, isBinary: boolean) => {
        if (isBinary) return;
        const msg = JSON.parse(String(data)) as { type: string; data: unknown };
        if (msg.type === "hello") ws.send(JSON.stringify({ type: "subscribe", runId: "12345678", frames: true, video: "h265" }));
        if (msg.type === "stream") resolve(msg.data);
      });
      ws.once("error", reject);
    });
    ws.close();
    expect(stream).toEqual({ video: null, reason: "codec" });
  } finally {
    await h.close();
    cleanTempDirs();
  }
});
