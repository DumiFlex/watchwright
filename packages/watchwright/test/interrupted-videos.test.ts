import { existsSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { dropEmptyVideos } from "../src/plugins/runs/engine.js";
import { cleanTempDirs, tempDir, writeFiles } from "./helpers/fixtures.js";

afterEach(() => cleanTempDirs());

describe("a run a killed server interrupted", () => {
  it("loses the empty videos it was writing, and keeps the rest", () => {
    const dir = tempDir("ww-run-");
    writeFiles(dir, {
      "run-video.webm": "",
      "T1/attempt-1/video-p1.webm": "webm",
      "T2/attempt-1/video-p1.webm": "",
      "T2/attempt-1/01-home.png": "",
    });
    dropEmptyVideos(dir);
    expect(existsSync(path.join(dir, "run-video.webm"))).toBe(false);
    expect(existsSync(path.join(dir, "T2", "attempt-1", "video-p1.webm"))).toBe(false);
    expect(existsSync(path.join(dir, "T1", "attempt-1", "video-p1.webm"))).toBe(true);
    expect(existsSync(path.join(dir, "T2", "attempt-1", "01-home.png"))).toBe(true);
    dropEmptyVideos(path.join(dir, "missing"));
  });
});
