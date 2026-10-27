import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { byteRange } from "../src/plugins/runs/plugin.js";
import { startHarness } from "./helpers/harness.js";

describe("byte ranges", () => {
  it("reads the forms a video element and the trace viewer send", () => {
    expect(byteRange(undefined, 100)).toBeNull();
    expect(byteRange("bytes=0-", 100)).toEqual([0, 99]);
    expect(byteRange("bytes=10-19", 100)).toEqual([10, 19]);
    expect(byteRange("bytes=90-500", 100)).toEqual([90, 99]);
    expect(byteRange("bytes=-10", 100)).toEqual([90, 99]);
  });
  it("refuses ranges it can't meet", () => {
    expect(byteRange("bytes=100-", 100)).toBe("bad");
    expect(byteRange("bytes=5-2", 100)).toBe("bad");
    expect(byteRange("bytes=-", 100)).toBe("bad");
    expect(byteRange("bytes=0-1,5-6", 100)).toBe("bad");
    expect(byteRange("items=0-1", 100)).toBe("bad");
  });
});

describe("trace viewer", () => {
  it("is served from playwright-core on our own origin", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ww-trace-"));
    const h = await startHarness(dir);
    try {
      const page = await h.app.inject({ url: "/api/v1/trace-viewer/index.html", headers: { host: h.host } });
      expect(page.statusCode).toBe(200);
      expect(page.headers["content-type"]).toMatch(/text\/html/);
      const sw = await h.app.inject({ url: "/api/v1/trace-viewer/sw.bundle.js", headers: { host: h.host } });
      expect(sw.statusCode).toBe(200);
      const missing = await h.app.inject({ url: "/api/v1/trace-viewer/nope.js", headers: { host: h.host } });
      expect(missing.statusCode).toBe(404);
      expect(missing.json()).toMatchObject({ error: { code: "not_found" } });
    } finally {
      await h.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
