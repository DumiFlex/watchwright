import { describe, expect, it } from "vitest";
import { FrameHub, REWIND_GAP_MS, REWIND_GRACE_MS, REWIND_MS } from "../src/plugins/live/hub.js";

const frame = (pageId: string, timestamp: number) => ({ runId: "aaaaaaaa", pageId, timestamp, width: 10, height: 10, data: Buffer.from([timestamp % 256]) });

describe("rewind buffer", () => {
  it("keeps at most one frame per gap per page, for the last 30 s", () => {
    const hub = new FrameHub();
    for (let t = 0; t <= 40_000; t += 50) hub.publish(frame("p1", t));
    hub.publish(frame("p2", 40_010));
    const kept = hub.history("aaaaaaaa");
    expect(kept[0]!.timestamp).toBeGreaterThanOrEqual(40_000 - REWIND_MS);
    const p1 = kept.filter((f) => f.pageId === "p1");
    expect(p1.length).toBe(REWIND_MS / REWIND_GAP_MS); // 10.01 s to 40 s, every 200 ms
    for (let i = 1; i < p1.length; i++) expect(p1[i]!.timestamp - p1[i - 1]!.timestamp).toBeGreaterThanOrEqual(REWIND_GAP_MS);
    expect(kept.at(-1)!.pageId).toBe("p2");
  });

  it("finds the frame at or before a moment, and forgets a run", () => {
    const hub = new FrameHub();
    hub.publish(frame("p1", 1000));
    hub.publish(frame("p1", 1400));
    expect(hub.frameAt("aaaaaaaa", "p1", 1399)?.timestamp).toBe(1000);
    expect(hub.frameAt("aaaaaaaa", "p1", 1400)?.timestamp).toBe(1400);
    expect(hub.frameAt("aaaaaaaa", "p1", 999)).toBeNull();
    hub.forget("aaaaaaaa", "p1");
    expect(hub.history("aaaaaaaa")).toHaveLength(2);
    hub.forget("aaaaaaaa");
    expect(hub.history("aaaaaaaa")).toEqual([]);
  });

  it("keeps a listed frame fetchable for a while after it leaves the list", () => {
    const hub = new FrameHub();
    hub.publish(frame("p1", 1000));
    const listed = hub.history("aaaaaaaa")[0]!;
    hub.publish(frame("p1", 1000 + REWIND_MS + 5000));
    expect(hub.history("aaaaaaaa").map((f) => f.timestamp)).toEqual([1000 + REWIND_MS + 5000]);
    expect(hub.frameAt("aaaaaaaa", "p1", listed.timestamp)?.timestamp).toBe(1000);
    hub.publish(frame("p1", 1000 + REWIND_MS + REWIND_GRACE_MS + 1));
    expect(hub.frameAt("aaaaaaaa", "p1", listed.timestamp)).toBeNull();
  });
});
