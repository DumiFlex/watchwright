import { describe, expect, it } from "vitest";
import { fitScale, keepPoint, MAX_ZOOM, MIN_ZOOM, percent, stepZoom, wheelZoom } from "../src/zoom";

describe("image zoom", () => {
  it("fits an image in the stage without blowing it up", () => {
    expect(fitScale({ width: 2560, height: 1600 }, { width: 1280, height: 1000 })).toBe(0.5);
    expect(fitScale({ width: 1280, height: 3200 }, { width: 1280, height: 800 })).toBe(0.25);
    expect(fitScale({ width: 400, height: 300 }, { width: 1280, height: 800 })).toBe(1);
    expect(fitScale({ width: 0, height: 0 }, { width: 1280, height: 800 })).toBe(1);
  });

  it("steps up and down from any scale", () => {
    expect(stepZoom(1, 1)).toBe(1.5);
    expect(stepZoom(1, -1)).toBe(0.75);
    expect(stepZoom(0.62, 1)).toBe(0.75);
    expect(stepZoom(0.62, -1)).toBe(0.5);
    expect(stepZoom(MAX_ZOOM, 1)).toBe(MAX_ZOOM);
    expect(stepZoom(MIN_ZOOM, -1)).toBe(MIN_ZOOM);
  });

  it("zooms smoothly with the wheel, inside the range", () => {
    expect(wheelZoom(1, -100)).toBeGreaterThan(1);
    expect(wheelZoom(1, 100)).toBeLessThan(1);
    expect(wheelZoom(MAX_ZOOM, -1000)).toBe(MAX_ZOOM);
    expect(wheelZoom(MIN_ZOOM, 1000)).toBe(MIN_ZOOM);
  });

  it("keeps the point under the pointer in place", () => {
    expect(keepPoint({ left: 0, top: 0 }, { x: 100, y: 50 }, 1, 2)).toEqual({ left: 100, top: 50 });
    expect(keepPoint({ left: 100, top: 50 }, { x: 100, y: 50 }, 2, 1)).toEqual({ left: 0, top: 0 });
    expect(percent(0.5)).toBe("50%");
  });
});
