import { chmodSync, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { afterEach, describe, expect, it } from "vitest";
import { browsersPath, encodeArgs, ffmpegArgs, findFfmpeg, frameQualityFor, qualityFps, scaleFilter, smallerThan, matroskaFrame, matroskaHeader, nextRunVideoFile, RunVideo, runVideoFiles, videoEncoder } from "../src/jobs/run-video.js";
import { cleanTempDirs, tempDir } from "./helpers/fixtures.js";
import { videoSize } from "./helpers/video.js";

afterEach(() => cleanTempDirs());

describe("finding Playwright's ffmpeg", () => {
  it("knows where Playwright keeps its browsers on each system", () => {
    expect(browsersPath({ PLAYWRIGHT_BROWSERS_PATH: "/pw" }, "linux", "/home/a")).toBe("/pw");
    expect(browsersPath({}, "linux", "/home/a")).toBe(path.join("/home/a", ".cache", "ms-playwright"));
    expect(browsersPath({}, "darwin", "/Users/a")).toBe(path.join("/Users/a", "Library", "Caches", "ms-playwright"));
    expect(browsersPath({ LOCALAPPDATA: "C:\\Users\\a\\AppData\\Local" }, "win32", "C:\\Users\\a")).toBe(path.join("C:\\Users\\a\\AppData\\Local", "ms-playwright"));
  });

  it("takes the newest ffmpeg folder that has a binary, or WATCHWRIGHT_FFMPEG", () => {
    const root = tempDir("ww-pw-");
    expect(findFfmpeg({}, root)).toBeNull();
    for (const [dir, bin] of [["ffmpeg-1009", "ffmpeg-linux"], ["ffmpeg-1011", "ffmpeg-win64.exe"], ["ffmpeg-1012", null]] as const) {
      mkdirSync(path.join(root, dir));
      if (bin) writeFileSync(path.join(root, dir, bin), "");
    }
    expect(findFfmpeg({}, root)).toBe(path.join(root, "ffmpeg-1011", "ffmpeg-win64.exe"));
    const own = path.join(root, "my-ffmpeg");
    writeFileSync(own, "");
    chmodSync(own, 0o755);
    expect(findFfmpeg({ WATCHWRIGHT_FFMPEG: own }, root)).toBe(own);
    expect(findFfmpeg({ WATCHWRIGHT_FFMPEG: path.join(root, "missing") }, root)).toBeNull();
    expect(findFfmpeg({}, path.join(root, "nowhere"))).toBeNull();
  });

  it("reads frames from a Matroska stream, fits other sizes in with crop and pad, and uses the encoder there is", () => {
    const vp9 = ffmpegArgs("/v.webm", 1280, 800, "libvpx-vp9").join(" ");
    expect(vp9).toContain("-f matroska");
    expect(vp9).toContain("-c:v libvpx-vp9");
    expect(vp9).toContain("-row-mt 1");
    expect(vp9).toContain("-fps_mode vfr");
    expect(vp9).toContain("crop=w=min(iw\\,1280):h=min(ih\\,800),pad=1280:800");
    expect(vp9).not.toContain("scale=");
    expect(vp9.endsWith("/v.webm")).toBe(true);
    const vp8 = ffmpegArgs("/v.webm", 1280, 800, "libvpx").join(" ");
    expect(vp8).toContain("-c:v libvpx -");
    expect(vp8).toContain("-speed 8");
  });

  it("spends a bit rate at full quality and a constant quality below it, and says the quality in the title", () => {
    const full = encodeArgs("libvpx-vp9", "full", "1M").join(" ");
    expect(full).toContain("-crf 10 -b:v 1M");
    expect(full).toContain("title=watchwright-video:full");
    const compact = encodeArgs("libvpx-vp9", "compact").join(" ");
    expect(compact).toContain("-qmax 63 -crf 40 -b:v 0");
    expect(compact).toContain("title=watchwright-video:compact");
    expect(encodeArgs("libvpx", "small").join(" ")).toContain("-crf 42 -b:v 0");
  });

  it("encodes high at a low constant quality with a little more effort, and caps VP8, which can't do a pure constant quality well", () => {
    const vp9 = encodeArgs("libvpx-vp9", "high").join(" ");
    expect(vp9).toContain("-qmax 63 -crf 24 -b:v 0");
    expect(vp9).toContain("-cpu-used 6");
    expect(vp9).toContain("-threads 2");
    expect(vp9).toContain("title=watchwright-video:high");
    const vp8 = encodeArgs("libvpx", "high").join(" ");
    expect(vp8).toContain("-qmax 40 -crf 8 -b:v 4M");
    expect(vp8).toContain("-speed 8");
    expect(encodeArgs("libvpx-vp9", "compact").join(" ")).toContain("-cpu-used 8");
    expect(encodeArgs("libvpx-vp9", "compact").join(" ")).toContain("-threads 1");
    // High keeps the size and takes 30 frames a second, from frames at JPEG 90 or more.
    expect(scaleFilter("high", 1920, 1080)).toBeNull();
    expect(qualityFps("high", 25)).toBe(30);
    expect(qualityFps("high", 10)).toBe(30);
    expect(frameQualityFor("high", 70)).toBe(90);
    expect(frameQualityFor("high", 95)).toBe(95);
    expect(frameQualityFor("full", 70)).toBe(70);
    expect(smallerThan("full", "high")).toBe(true);
    expect(smallerThan("high", "full")).toBe(false);
  });

  it("scales a small video to 3/4 after fitting it in, at 10 frames a second", () => {
    expect(scaleFilter("full", 1600, 960)).toBeNull();
    expect(scaleFilter("compact", 1600, 960)).toBeNull();
    expect(scaleFilter("small", 1600, 960)).toBe("scale=1200:720");
    expect(scaleFilter("small", 1366, 768)).toBe("scale=1024:576");
    expect(ffmpegArgs("/v.webm", 1600, 960, "libvpx-vp9", "1M", "small").join(" ")).toContain("pad=1600:960:(ow-iw)/2:(oh-ih)/2,scale=1200:720");
    expect(qualityFps("small", 25)).toBe(10);
    expect(qualityFps("compact", 25)).toBe(25);
    expect(qualityFps("full", 25)).toBe(25);
    expect(smallerThan("small", "compact")).toBe(true);
    expect(smallerThan("compact", "full")).toBe(true);
    expect(smallerThan("full", "compact")).toBe(false);
    expect(smallerThan("compact", "compact")).toBe(false);
  });

  it("writes Matroska the way the spec has it: EBML header, a V_MJPEG track, a cluster per frame", () => {
    const head = matroskaHeader();
    expect(head.subarray(0, 4).toString("hex")).toBe("1a45dfa3");
    expect(head.includes(Buffer.from("V_MJPEG"))).toBe(true);
    // A cluster at 1234 ms holding a 300-byte frame: its id, its size (311: the timestamp, the
    // block header and the frame), the timestamp element, then a key-frame block on track 1.
    expect(matroskaFrame(1234, 300).toString("hex")).toBe("1f43b675" + "4137" + "e78204d2" + "a3" + "4130" + "81" + "0000" + "80");
  });
});

describe("run video files", () => {
  it("numbers the parts and lists them in order", () => {
    const dir = tempDir("ww-run-");
    expect(runVideoFiles(dir)).toEqual([]);
    expect(nextRunVideoFile(dir)).toBe(path.join(dir, "run-video.webm"));
    writeFileSync(path.join(dir, "run-video.webm"), "a");
    writeFileSync(path.join(dir, "run-video-10.webm"), "abc");
    writeFileSync(path.join(dir, "run-video-2.webm"), "ab");
    writeFileSync(path.join(dir, "video-p1.webm"), "x");
    expect(nextRunVideoFile(dir)).toBe(path.join(dir, "run-video-3.webm"));
    expect(runVideoFiles(dir)).toEqual([
      { name: "run-video.webm", size: 1 },
      { name: "run-video-2.webm", size: 2 },
      { name: "run-video-10.webm", size: 3 },
    ]);
  });
});

const ffmpeg = findFfmpeg();
describe.skipIf(!ffmpeg)("recording", () => {
  it("writes each new frame with its time into a WebM, and fits a frame of another size", { timeout: 30_000 }, async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
    await page.setContent("<body style='background:#c33'><h1>one</h1></body>");
    const small = await page.screenshot({ type: "jpeg" });
    await page.setViewportSize({ width: 300, height: 300 });
    const square = await page.screenshot({ type: "jpeg" });
    await browser.close();

    expect(["libvpx-vp9", "libvpx"]).toContain(videoEncoder(ffmpeg!));
    const dir = tempDir("ww-run-");
    const file = nextRunVideoFile(dir);
    const errors: string[] = [];
    let frame: { data: Buffer; width: number; height: number } | null = null;
    const v = new RunVideo({ file, ffmpeg: ffmpeg!, frame: () => frame, onError: (m) => errors.push(m), fps: 20 });
    v.start();
    await new Promise((r) => setTimeout(r, 150));
    frame = { data: small, width: 320, height: 200 };
    await new Promise((r) => setTimeout(r, 500));
    frame = { data: square, width: 300, height: 300 };
    await new Promise((r) => setTimeout(r, 500));
    const written = await v.stop();
    expect(errors).toEqual([]);
    expect(written).toBe(true);
    expect(existsSync(file)).toBe(true);
    // A WebM starts with the EBML magic number.
    const head = Buffer.alloc(4);
    const fd = await import("node:fs/promises").then((f) => f.open(file));
    await fd.read(head, 0, 4, 0);
    await fd.close();
    expect(head.toString("hex")).toBe("1a45dfa3");
    expect(statSync(file).size).toBeGreaterThan(500);
  });

  it("keeps a size it's given, whatever size the first frame has", { timeout: 30_000 }, async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 200, height: 120 } });
    await page.setContent("<body style='background:#36c'><h1>small</h1></body>");
    const shot = await page.screenshot({ type: "jpeg" });
    await browser.close();
    const file = path.join(tempDir("ww-run-"), "v.webm");
    const v = new RunVideo({ file, ffmpeg: ffmpeg!, frame: () => ({ data: shot, width: 200, height: 120 }), onError: () => undefined, fps: 20, size: { width: 320, height: 240 }, quality: "high" });
    v.start();
    await new Promise((r) => setTimeout(r, 400));
    expect(await v.stop()).toBe(true);
    expect(videoSize(ffmpeg!, file)).toBe("320x240");
  });

  it("says once when ffmpeg fails, and keeps quiet after", async () => {
    const dir = tempDir("ww-run-");
    const errors: string[] = [];
    const v = new RunVideo({ file: path.join(dir, "nested", "missing", "v.webm"), ffmpeg: ffmpeg!, frame: () => ({ data: Buffer.from("not a jpeg"), width: 10, height: 10 }), onError: (m) => errors.push(m), fps: 20 });
    v.start();
    await new Promise((r) => setTimeout(r, 1500));
    await v.stop();
    expect(errors.length).toBe(1);
  });
});
