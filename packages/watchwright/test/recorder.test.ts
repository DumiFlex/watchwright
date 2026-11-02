import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AttemptRecorder, MAX_LOG_LINES, type LogLine } from "../src/jobs/recorder.js";

describe("attempt recorder", () => {
  it("keeps at most MAX_LOG_LINES log lines, says so once, and counts the rest", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ww-rec-"));
    try {
      const told: LogLine[] = [];
      const r = new AttemptRecorder(dir, dir, () => undefined, (l) => told.push(l));
      for (let i = 0; i < MAX_LOG_LINES + 250; i++) r.addLog("info", `line ${i}`);
      expect(r.log).toHaveLength(MAX_LOG_LINES + 1);
      expect(r.log.at(-1)).toMatchObject({ level: "warn", message: expect.stringMatching(/its limit/) });
      expect(r.droppedLog).toBe(250);
      expect(told).toHaveLength(MAX_LOG_LINES + 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
