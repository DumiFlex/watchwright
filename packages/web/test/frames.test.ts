import { describe, expect, it } from "vitest";
import { aroundStep, frameCount, frameTimes } from "../src/frames";

describe("frames", () => {
  it("spreads frames over the time, each in the middle of its slice", () => {
    expect(frameTimes(10_000, 4)).toEqual([1250, 3750, 6250, 8750]);
    expect(frameTimes(0, 4)).toEqual([]);
    expect(frameTimes(1000, 0)).toEqual([]);
  });

  it("fits as many frames as the width allows, within bounds", () => {
    expect(frameCount(1200)).toBe(10);
    expect(frameCount(200)).toBe(3);
    expect(frameCount(5000)).toBe(16);
  });

  it("takes the before just ahead of a step and the after once it settles, inside the video", () => {
    expect(aroundStep({ start: 14_200, end: 14_600 }, 24_000)).toEqual({ before: 14_050, after: 15_000 });
    expect(aroundStep({ start: 50, end: 300 }, 24_000).before).toBe(0);
    expect(aroundStep({ start: 23_000, end: 23_900 }, 24_000).after).toBe(23_950);
  });
});
