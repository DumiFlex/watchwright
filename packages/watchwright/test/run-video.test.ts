import { chmodSync, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { afterEach, describe, expect, it } from "vitest";
import { browsersPath, ffmpegArgs, findFfmpeg, nextRunVideoFile, RunVideo, runVideoFiles } from "../src/jobs/run-video.js";
import { cleanTempDirs, tempDir } from "./helpers/fixtures.js";

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

  it("fits frames of another size into the video's size", () => {
    const args = ffmpegArgs("/v.webm", 1280, 800);
    expect(args.join(" ")).toContain("crop=w=min(iw\\,1280):h=min(ih\\,800),pad=1280:800");
    expect(args.join(" ")).not.toContain("scale=");
    expect(args.at(-1)).toBe("/v.webm");
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
  it("writes the newest frame on a timer into a WebM, and fits a frame of another size", { timeout: 30_000 }, async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
    await page.setContent("<body style='background:#c33'><h1>one</h1></body>");
    const small = await page.screenshot({ type: "jpeg" });
    await page.setViewportSize({ width: 300, height: 300 });
    const square = await page.screenshot({ type: "jpeg" });
    await browser.close();

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
