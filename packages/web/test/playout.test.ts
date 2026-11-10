import { describe, expect, it } from "vitest";
import { Playout } from "../src/playout";

const frame = (name: string, closed: string[]) => ({ name, close: () => closed.push(name) });

describe("the live view's playback buffer", () => {
  it("shows frames at their capture times, a steady delay behind, however unevenly they arrive", () => {
    let now = 0;
    const closed: string[] = [];
    const p = new Playout<ReturnType<typeof frame>>(100, () => now);
    // Captured every 40 ms on the browser's clock (which is 5000 ms ahead), delivered bunched up.
    now = 50;
    p.add(5000, frame("a", closed)); // quickest delivery: 50 ms → offset −4950
    now = 160;
    p.add(5040, frame("b", closed));
    p.add(5080, frame("c", closed));
    now = 170;
    p.add(5120, frame("d", closed));
    expect(p.offset()).toBe(-4950);
    // Due at capture + offset + delay: a at 150, b at 190, c at 230, d at 270.
    now = 149;
    expect(p.due()).toBeNull();
    now = 150;
    expect(p.due()?.name).toBe("a");
    now = 200;
    expect(p.due()?.name).toBe("b");
    expect(p.due()).toBeNull();
    now = 240;
    expect(p.due()?.name).toBe("c");
    now = 300;
    expect(p.due()?.name).toBe("d");
    expect(closed).toEqual([]);
  });

  it("skips frames that are already late, and drops ones older than what was shown", () => {
    let now = 0;
    const closed: string[] = [];
    const p = new Playout<ReturnType<typeof frame>>(100, () => now);
    p.add(0, frame("a", closed));
    p.add(40, frame("b", closed));
    p.add(80, frame("c", closed));
    now = 500;
    // All three are due: only the newest is shown, the others are closed unseen.
    expect(p.due()?.name).toBe("c");
    expect(closed).toEqual(["a", "b"]);
    p.add(60, frame("old", closed));
    expect(closed).toEqual(["a", "b", "old"]);
    expect(p.size).toBe(0);
  });

  it("keeps frames in capture order even when they arrive out of it, and clears", () => {
    let now = 0;
    const closed: string[] = [];
    const p = new Playout<ReturnType<typeof frame>>(100, () => now);
    p.add(80, frame("c", closed));
    p.add(40, frame("b", closed));
    // Quickest delivery: c, 80 ms early on this clock → b due at 60, c at 100.
    now = 70;
    expect(p.due()?.name).toBe("b");
    expect(p.drain().map((f) => f.name)).toEqual(["c"]);
    p.add(200, frame("d", closed));
    p.clear();
    expect(closed).toEqual(["d"]);
    expect(p.offset()).toBeNull();
  });
});
