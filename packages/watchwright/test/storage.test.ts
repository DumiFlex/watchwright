import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { dirSize, driveSpace, sizeText } from "../src/jobs/storage.js";
import { cleanTempDirs, tempDir } from "./helpers/fixtures.js";

afterEach(() => cleanTempDirs());

describe("storage", () => {
  it("adds up the files in a folder and the folders in it, without following links", async () => {
    const dir = tempDir("ww-size-");
    writeFileSync(path.join(dir, "a.txt"), "12345");
    mkdirSync(path.join(dir, "S1", "collectors"), { recursive: true });
    writeFileSync(path.join(dir, "S1", "video.webm"), Buffer.alloc(1000));
    writeFileSync(path.join(dir, "S1", "collectors", "c.json"), "[]");
    const outside = tempDir("ww-out-");
    writeFileSync(path.join(outside, "big"), Buffer.alloc(5000));
    try {
      symlinkSync(path.join(outside, "big"), path.join(dir, "link"));
    } catch {
      // Windows without the right to make links.
    }
    expect(await dirSize(dir)).toBe(1007);
    expect(await dirSize(path.join(dir, "missing"))).toBe(0);
  });

  it("reads the drive's free and total space", async () => {
    const d = await driveSpace(tempDir("ww-drive-"));
    expect(d).not.toBeNull();
    expect(d!.totalBytes).toBeGreaterThan(0);
    expect(d!.freeBytes).toBeGreaterThanOrEqual(0);
    expect(d!.freeBytes).toBeLessThanOrEqual(d!.totalBytes);
  });

  it("writes sizes for people", () => {
    expect(sizeText(820)).toBe("820 B");
    expect(sizeText(12 * 1024)).toBe("12 KB");
    expect(sizeText(3.4 * 1024 ** 2)).toBe("3.4 MB");
    expect(sizeText(1.25 * 1024 ** 3)).toBe("1.3 GB");
  });
});
