import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { afterEach, describe, expect, it } from "vitest";
import { findFfmpeg, RunVideo, videoEncoder, type VideoQuality } from "../src/jobs/run-video.js";
import { compressArgs, compressVideo, replaceFile, runVideos, videoQualityOf, wantsCompress } from "../src/jobs/video-compress.js";
import { VideoCompressor } from "../src/plugins/runs/videos.js";
import { finishArgs, runFfmpeg } from "../src/jobs/video-finish.js";
import { BrowserSession, FOLLOW_VIDEO, type SavedVideo } from "../src/session/session.js";
import { videoSize } from "./helpers/video.js";
import { cleanTempDirs, tempDir } from "./helpers/fixtures.js";

afterEach(() => cleanTempDirs());

/** Encodes a recorded video the way the finisher does on the CPU, and removes its capture. */
async function finish(v: SavedVideo, quality: VideoQuality): Promise<string> {
  const ff = findFfmpeg()!;
  const c = v.capture!;
  const r = await runFfmpeg(ff, finishArgs(c.file, v.path, c.width, c.height, quality, { kind: "cpu", ffmpeg: ff, codec: videoEncoder(ff)! }, 2));
  expect(r).toMatchObject({ code: 0 });
  rmSync(c.file);
  return v.path;
}

describe("kept videos", () => {
  it("reads a video's quality from its title, and takes a video without one as full", async () => {
    const dir = tempDir("ww-vq-");
    writeFileSync(path.join(dir, "a.webm"), Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.from("....title watchwright-video:compact ....")]));
    writeFileSync(path.join(dir, "b.webm"), Buffer.alloc(100));
    writeFileSync(path.join(dir, "c.webm"), Buffer.from("watchwright-video:huge"));
    writeFileSync(path.join(dir, "d.webm"), Buffer.from("....watchwright-video:high...."));
    expect(await videoQualityOf(path.join(dir, "a.webm"))).toBe("compact");
    expect(await videoQualityOf(path.join(dir, "b.webm"))).toBe("full");
    expect(await videoQualityOf(path.join(dir, "c.webm"))).toBe("full");
    expect(await videoQualityOf(path.join(dir, "d.webm"))).toBe("high");
    expect(await videoQualityOf(path.join(dir, "missing.webm"))).toBe("full");
  });

  it("compresses only what gets smaller at the target", () => {
    expect(wantsCompress("full", "compact")).toBe(true);
    expect(wantsCompress("compact", "small")).toBe(true);
    expect(wantsCompress("compact", "compact")).toBe(false);
    expect(wantsCompress("small", "compact")).toBe(false);
    expect(wantsCompress("full", "full")).toBe(false);
    // High videos were recorded to be watched: never compressed.
    expect(wantsCompress("high", "compact")).toBe(false);
    expect(wantsCompress("high", "small")).toBe(false);
    expect(wantsCompress("full", "high")).toBe(false);
  });

  it("finds every video of a run and clears files a stopped compress left", async () => {
    const dir = tempDir("ww-run-");
    mkdirSync(path.join(dir, "T1", "attempt-1"), { recursive: true });
    writeFileSync(path.join(dir, "T1", "attempt-1", "video-p1.webm"), "ab");
    writeFileSync(path.join(dir, "T1", "attempt-1", "video-p2.compressing.webm"), "x");
    writeFileSync(path.join(dir, "T1", "attempt-1", "shot.png"), "x");
    writeFileSync(path.join(dir, "run-video.webm"), "abc");
    expect((await runVideos(dir)).length).toBe(2);
    // Left in place while a compress may be writing it, removed with clean.
    expect(existsSync(path.join(dir, "T1", "attempt-1", "video-p2.compressing.webm"))).toBe(true);
    const list = await runVideos(dir, { clean: true });
    expect(list.map((v) => [path.relative(dir, v.file).split(path.sep).join("/"), v.size])).toEqual([
      ["run-video.webm", 3],
      ["T1/attempt-1/video-p1.webm", 2],
    ]);
    expect(existsSync(path.join(dir, "T1", "attempt-1", "video-p2.compressing.webm"))).toBe(false);
    expect(await runVideos(path.join(dir, "missing"))).toEqual([]);
  });

  it("tries the rename again while Windows refuses it, and gives up on other errors", async () => {
    const err = (code: string) => Object.assign(new Error(code), { code });
    let calls = 0;
    await replaceFile("a", "b", { waitMs: 1, rename: async () => { if (++calls < 3) throw err("EPERM"); } });
    expect(calls).toBe(3);
    calls = 0;
    await expect(replaceFile("a", "b", { waitMs: 1, rename: async () => { calls++; throw err("ENOENT"); } })).rejects.toMatchObject({ code: "ENOENT" });
    expect(calls).toBe(1);
    calls = 0;
    await expect(replaceFile("a", "b", { waitMs: 1, tries: 4, rename: async () => { calls++; throw err("EBUSY"); } })).rejects.toMatchObject({ code: "EBUSY" });
    expect(calls).toBe(4);
  });

  it("decodes the WebM and writes a smaller one, scaled for small", () => {
    const compact = compressArgs("/in.webm", "/out.webm", "libvpx-vp9", "compact").join(" ");
    expect(compact).toContain("-i /in.webm");
    expect(compact).toContain("-crf 40 -b:v 0");
    expect(compact).not.toContain("scale=");
    expect(compact.endsWith("-f webm /out.webm")).toBe(true);
    const small = compressArgs("/in.webm", "/out.webm", "libvpx", "small").join(" ");
    expect(small).toContain("-r 10 -vf scale=trunc(iw*3/8)*2:trunc(ih*3/8)*2");
    expect(small).toContain("title=watchwright-video:small");
  });
});

function compressor(o: { dataDir: string; runs: string[]; quality: VideoQuality; busy?: () => boolean; ffmpeg?: string | null }) {
  const events: { type: string; data: Record<string, unknown> }[] = [];
  const sizes = new Map<string, number>();
  const measured: string[] = [];
  const c = new VideoCompressor({
    dataDir: o.dataDir,
    repo: { endedRunIds: () => o.runs, updateArtifactSize: (p, s) => sizes.set(p, s) },
    events: { append: (type, data = {}) => events.push({ type, data }) },
    quality: () => o.quality,
    busy: o.busy ?? (() => false),
    measure: async (id) => measured.push(id),
    checkMs: 50,
    findFfmpeg: () => (o.ffmpeg === undefined ? findFfmpeg() : o.ffmpeg),
  });
  return { c, events, sizes, measured };
}

describe("Compress kept videos", () => {
  it("doesn't start at full quality, while a run goes, or without ffmpeg", async () => {
    const dataDir = tempDir("ww-data-");
    await expect(compressor({ dataDir, runs: [], quality: "full", ffmpeg: "/x" }).c.start("web")).rejects.toMatchObject({ code: "quality_full" });
    await expect(compressor({ dataDir, runs: [], quality: "high", ffmpeg: "/x" }).c.start("web")).rejects.toMatchObject({ code: "quality_full", message: expect.stringContaining("High") });
    await expect(compressor({ dataDir, runs: [], quality: "compact", busy: () => true }).c.start("web")).rejects.toMatchObject({ code: "run_going", status: 409 });
    await expect(compressor({ dataDir, runs: [], quality: "compact", ffmpeg: null }).c.start("web")).rejects.toMatchObject({ code: "no_ffmpeg" });
  });

  it("counts the videos runs keep and the ones that can get smaller", async () => {
    const dataDir = tempDir("ww-data-");
    mkdirSync(path.join(dataDir, "runs", "r1"), { recursive: true });
    writeFileSync(path.join(dataDir, "runs", "r1", "run-video.webm"), Buffer.alloc(1000));
    writeFileSync(path.join(dataDir, "runs", "r1", "run-video-2.webm"), Buffer.from("watchwright-video:compact"));
    const r = await compressor({ dataDir, runs: ["r1"], quality: "compact", ffmpeg: null }).c.report();
    expect(r).toMatchObject({ quality: "compact", ffmpeg: false, videos: 2, bytes: 1025, toCompress: 1, toCompressBytes: 1000, job: null });
  });
});

const ffmpeg = findFfmpeg();
/** A real attempt-like video at full quality: a page that types for a while, as RunVideo writes it. */
async function realVideo(file: string): Promise<void> {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
  const shots: Buffer[] = [];
  for (let i = 0; i < 12; i++) {
    await page.setContent(`<body style="font:20px sans-serif"><h1>Step ${i}</h1><p>${"Some words on the page. ".repeat(i * 3)}</p></body>`);
    shots.push(await page.screenshot({ type: "jpeg", quality: 80 }));
  }
  await browser.close();
  let n = 0;
  const v = new RunVideo({ file, ffmpeg: ffmpeg!, frame: () => ({ data: shots[Math.min(n, shots.length - 1)]!, width: 640, height: 400 }), onError: () => undefined, fps: 25, bitRate: "1M" });
  v.start();
  const timer = setInterval(() => n++, 150);
  await new Promise((r) => setTimeout(r, 2200));
  clearInterval(timer);
  expect(await v.stop()).toBe(true);
  expect(statSync(file).size).toBeGreaterThan(1000);
}

describe.skipIf(!ffmpeg)("compressing with Playwright's ffmpeg", () => {
  it("encodes a full video again smaller, marks it, and replaces it", { timeout: 60_000 }, async () => {
    const dir = tempDir("ww-vc-");
    const file = path.join(dir, "video-p1.webm");
    await realVideo(file);
    expect(await videoQualityOf(file)).toBe("full");
    const before = statSync(file).size;
    const r = await compressVideo(ffmpeg!, videoEncoder(ffmpeg!)!, file, "small");
    expect(r.before).toBe(before);
    expect(r.replaced).toBe(true);
    {
      expect(r.after).toBeLessThan(before);
      expect(statSync(file).size).toBe(r.after);
      expect(await videoQualityOf(file)).toBe("small");
    }
    expect(readdirSync(dir)).toEqual(["video-p1.webm"]);
  });

  it("runs as a job, updates sizes, measures the runs, and stops when a run starts", { timeout: 90_000 }, async () => {
    const dataDir = tempDir("ww-data-");
    const runDir = path.join(dataDir, "runs", "r1", "T1", "attempt-1");
    mkdirSync(runDir, { recursive: true });
    await realVideo(path.join(runDir, "video-p1.webm"));
    const { c, events, sizes, measured } = compressor({ dataDir, runs: ["r1"], quality: "compact" });
    const job = await c.start("web");
    expect(job).toMatchObject({ state: "running", total: 1, done: 0, quality: "compact" });
    await expect(c.start("web")).rejects.toMatchObject({ code: "compress_going" });
    let report = await c.report();
    // Reports while the job goes (the page asks every 2 seconds) leave its file alone.
    for (let i = 0; i < 300 && report.job?.state === "running"; i++) {
      await new Promise((r) => setTimeout(r, 20));
      report = await c.report();
    }
    expect(report.job, report.job?.reason ?? "").toMatchObject({ state: "done", done: 1, failed: 0 });
    expect(report.job!.kept).toBe(0);
    {
      expect(sizes.get("runs/r1/T1/attempt-1/video-p1.webm")).toBe(statSync(path.join(runDir, "video-p1.webm")).size);
      expect(measured).toEqual(["r1"]);
      expect(report.toCompress).toBe(0);
    }
    expect(events.map((e) => e.type)).toEqual(["videos.compress.started", "videos.compressed"]);

    // A run that starts stops the next job at once.
    await realVideo(path.join(runDir, "video-p2.webm"));
    let busy = false;
    const second = compressor({ dataDir, runs: ["r1"], quality: "small", busy: () => busy });
    await second.c.start("web");
    busy = true;
    const stopped = await second.c.stop("never mind");
    expect(["stopped", "done"]).toContain(stopped!.state);
    expect(readdirSync(runDir).filter((f) => f.includes("compressing"))).toEqual([]);
  });
});

describe.skipIf(!ffmpeg)("recording at a smaller quality", () => {
  it("writes Chromium's attempt videos itself, at that quality, while the live frames keep their size", { timeout: 60_000 }, async () => {
    const widths = new Set<number>();
    const s = await BrowserSession.launch(
      { browser: "chromium", headless: true, viewport: { width: 640, height: 400 }, quality: 70, showActions: false, trace: false, videoQuality: "small" },
      { onFrame: (f) => widths.add(f.width) },
    );
    try {
      const dir = tempDir("ww-vq-");
      const page = await s.mainPage();
      await s.restartCapture(dir);
      for (let i = 0; i < 8; i++) {
        await page.setContent(`<body style="background:hsl(${i * 40},50%,40%)"><h1>Frame ${i}</h1></body>`);
        await page.waitForTimeout(120);
      }
      const saved = await s.stopCapture();
      expect(saved).toHaveLength(1);
      // Recorded as the frames came, nothing encoded yet.
      expect(saved[0]!.capture).toMatchObject({ width: 640, height: 400 });
      expect(saved[0]!.capture!.frames).toBeGreaterThan(3);
      expect(existsSync(saved[0]!.path)).toBe(false);
      await finish(saved[0]!, "small");
      expect(statSync(saved[0]!.path).size).toBeGreaterThan(500);
      expect(await videoQualityOf(saved[0]!.path)).toBe("small");
      expect(videoSize(ffmpeg!, saved[0]!.path)).toBe("480x300");
      expect([...widths]).toEqual([640]);
    } finally {
      await s.close();
    }
  });
});

describe.skipIf(!ffmpeg)("recording at high quality", () => {
  it("writes the videos itself at high quality from sharper frames", { timeout: 60_000 }, async () => {
    const s = await BrowserSession.launch({ browser: "chromium", headless: true, viewport: { width: 640, height: 400 }, quality: 70, showActions: false, trace: false, videoQuality: "high" });
    try {
      const dir = tempDir("ww-vq-");
      const page = await s.mainPage();
      await s.restartCapture(dir);
      for (let i = 0; i < 6; i++) {
        await page.setContent(`<body><h1>Frame ${i}</h1><p style="font-size:11px">${"small text ".repeat(80)}</p></body>`);
        await page.waitForTimeout(120);
      }
      const saved = await s.stopCapture();
      expect(saved).toHaveLength(1);
      await finish(saved[0]!, "high");
      expect(await videoQualityOf(saved[0]!.path)).toBe("high");
    } finally {
      await s.close();
    }
  });
});

describe.skipIf(!ffmpeg)("an attempt video that follows the live view", () => {
  it("records one video across a popup and back, at the screencast size, instead of one per page", { timeout: 60_000 }, async () => {
    const opened: string[] = [];
    const s = await BrowserSession.launch(
      { browser: "chromium", headless: true, viewport: { width: 640, height: 400 }, quality: 70, showActions: false, trace: false, videoQuality: "compact" },
      { onPageOpened: (id) => opened.push(id) },
    );
    try {
      const dir = tempDir("ww-follow-");
      const page = await s.mainPage();
      await page.setContent(`<body style="background:#c33"><h1>Main</h1></body>`);
      await s.restartCapture(dir, { follow: true });
      await page.waitForTimeout(300);
      const [popup] = await Promise.all([page.waitForEvent("popup"), page.evaluate("void window.open('about:blank', '_blank', 'width=300,height=200')")]);
      await popup.setContent(`<body style="background:#3c3"><h1>Popup</h1></body>`);
      expect(s.activePage).toBe(s.pageId(popup));
      await popup.waitForTimeout(400);
      await popup.close();
      expect(s.activePage).toBe(s.pageId(page));
      await page.setContent(`<body style="background:#33c"><h1>Back</h1></body>`);
      await page.waitForTimeout(300);
      const saved = await s.stopCapture();
      expect(saved).toMatchObject([{ pageId: FOLLOW_VIDEO, path: path.join(dir, "video.webm"), capture: { file: path.join(dir, "video.capture.mkv"), width: 640, height: 400 } }]);
      expect(readdirSync(dir)).toEqual(["video.capture.mkv"]);
      await finish(saved[0]!, "compact");
      expect(readdirSync(dir)).toEqual(["video.webm"]);
      expect(await videoQualityOf(saved[0]!.path)).toBe("compact");
      expect(videoSize(ffmpeg!, saved[0]!.path)).toBe("640x400");
      expect(opened).toHaveLength(2);

      // Without follow, the next capture goes back to one video per page.
      await s.restartCapture(dir);
      await page.waitForTimeout(300);
      const perPage = await s.stopCapture();
      expect(perPage.map((v) => path.basename(v.path))).toEqual([`video-${s.pageId(page)}.webm`]);
    } finally {
      await s.close();
    }
  });
});
