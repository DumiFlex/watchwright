import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { chromium, firefox, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findFfmpeg, videoEncoder } from "../src/jobs/run-video.js";
import { FlashFilter, flashBlocks } from "../src/session/flash-filter.js";
import { jpegLuma } from "../src/session/jpeg-dc.js";
import { BrowserSession } from "../src/session/session.js";
import { cleanTempDirs, tempDir } from "./helpers/fixtures.js";
import { hasChromium, hasFirefox, requireBrowsers } from "./helpers/harness.js";

// Firefox's screencast sometimes sends a frame with whole tiles not painted yet; the flash filter
// drops those frames (docs: guide/runs, "Videos").

const PAGE = (blank: { x: number; y: number; w: number; h: number } | null, extra = "") => `<!doctype html>
<body style="margin:0;background:#101318;color:#ddd;font:16px sans-serif">
  <div style="position:absolute;left:0;top:0;width:800px;height:480px;background:linear-gradient(90deg,#334,#99a 50%,#eee)"></div>
  <div style="position:absolute;left:40px;top:40px;width:300px;height:120px;background:#c33"></div>
  ${blank ? `<div style="position:absolute;left:${blank.x}px;top:${blank.y}px;width:${blank.w}px;height:${blank.h}px;background:#101318"></div>` : ""}
  ${extra}
</body>`;

const browsers = hasChromium || requireBrowsers ? describe : describe.skip;

browsers("flash filter", () => {
  let browser: Browser;
  let page: Page;
  const shot = async (html: string) => {
    await page.setContent(html);
    return page.screenshot({ type: "jpeg", quality: 80 });
  };
  beforeAll(async () => {
    browser = await chromium.launch();
    page = await browser.newPage({ viewport: { width: 800, height: 480 } });
  });
  afterAll(async () => {
    await browser.close();
    cleanTempDirs();
  });

  it("reads each 8×8 block's brightness from a baseline JPEG", async () => {
    const g = jpegLuma(await shot(PAGE(null)))!;
    expect(g).toMatchObject({ cols: 100, rows: 60 });
    // The red box: luma of #c33 is about 98; the gradient's right end is near white.
    expect(g.luma[8 * 100 + 10]).toBeGreaterThan(85);
    expect(g.luma[8 * 100 + 10]).toBeLessThan(110);
    expect(g.luma[30 * 100 + 98]).toBeGreaterThan(220);
    expect(jpegLuma(Buffer.from("not a jpeg"))).toBeNull();
    expect(jpegLuma(Buffer.from([0xff, 0xd8, 0xff, 0xc2, 0, 2]))).toBeNull();
  });

  it("drops a frame whose tiles flash to the background, and keeps real changes", async () => {
    const whole = await shot(PAGE(null));
    const flash = await shot(PAGE({ x: 256, y: 0, w: 512, h: 256 }));
    const moved = await shot(PAGE(null, `<div style="position:absolute;left:400px;top:300px;width:300px;height:150px;background:#3c3"></div>`));
    const hover = await shot(PAGE(null, `<div style="position:absolute;left:420px;top:200px;width:120px;height:30px;background:#fff"></div>`));
    expect(flashBlocks(jpegLuma(whole)!, jpegLuma(flash)!, jpegLuma(whole)!)).toBeGreaterThan(1000);

    const run = (frames: Buffer[]) => {
      const out: Buffer[] = [];
      const f = new FlashFilter<{ data: Buffer }>((fr) => out.push(fr.data), 60_000);
      for (const data of frames) f.push({ data });
      f.flush();
      return { out, dropped: f.dropped };
    };
    // A flash between two whole frames goes; so does one that comes back as the same page.
    expect(run([whole, flash, whole])).toEqual({ out: [whole, whole], dropped: 1 });
    // A change that stays, a change that goes back after one frame but is small, and the first frame, all stay.
    expect(run([whole, moved, moved]).dropped).toBe(0);
    expect(run([whole, hover, whole]).dropped).toBe(0);
    expect(run([flash, whole]).dropped).toBe(0);
  });

  it("lets a held frame out when no next frame comes", async () => {
    const whole = await shot(PAGE(null));
    const out: Buffer[] = [];
    const f = new FlashFilter<{ data: Buffer }>((fr) => out.push(fr.data), 30);
    f.push({ data: whole });
    expect(out).toHaveLength(0);
    await new Promise((r) => setTimeout(r, 80));
    expect(out).toEqual([whole]);
  });
});

const ffmpeg = findFfmpeg();
const canEncode = !!ffmpeg && !!videoEncoder(ffmpeg);
const firefoxVideo = (hasFirefox || requireBrowsers) && canEncode ? describe : describe.skip;

firefoxVideo("Firefox sessions", () => {
  it("write their attempt videos from the filtered frames", { timeout: 60_000 }, async () => {
    expect(firefox).toBeDefined();
    const frames: number[] = [];
    const s = await BrowserSession.launch({ browser: "firefox", headless: true, viewport: { width: 640, height: 400 }, quality: 70, showActions: false, trace: false }, { onFrame: (f) => frames.push(f.timestamp) });
    try {
      const dir = tempDir("ww-flash-");
      const page = await s.mainPage();
      await s.restartCapture(dir);
      for (let i = 0; i < 10; i++) {
        await page.setContent(`<body style="background:hsl(${i * 30},50%,40%)"><h1>Frame ${i}</h1></body>`);
        await page.waitForTimeout(100);
      }
      const saved = await s.stopCapture();
      expect(saved).toHaveLength(1);
      expect(path.dirname(saved[0]!.path)).toBe(dir);
      expect(existsSync(saved[0]!.path) && statSync(saved[0]!.path).size).toBeGreaterThan(1000);
      expect(frames.length).toBeGreaterThan(3);
    } finally {
      await s.close();
      cleanTempDirs();
    }
  });
});
