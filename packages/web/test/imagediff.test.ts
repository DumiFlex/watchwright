import { describe, expect, it } from "vitest";
import { changedText, diffPixels } from "../src/imagediff";

/** A w × h RGBA image filled with one color. */
const img = (w: number, h: number, rgb: [number, number, number]) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([...rgb, 255], i * 4);
  return { data, width: w };
};
const set = (im: { data: Uint8ClampedArray; width: number }, x: number, y: number, rgb: [number, number, number]) => im.data.set([...rgb, 255], (y * im.width + x) * 4);

describe("diffPixels", () => {
  it("finds the changed pixels and the box around them", () => {
    const a = img(4, 3, [200, 200, 200]);
    const b = img(4, 3, [200, 200, 200]);
    set(b, 1, 0, [0, 0, 0]);
    set(b, 2, 2, [0, 0, 0]);
    const d = diffPixels(a, b, 4, 3);
    expect(d.changed).toBe(2);
    expect(d.total).toBe(12);
    expect(d.box).toEqual({ x: 1, y: 0, w: 2, h: 3 });
    // changed pixels are marked, the rest is the newer image faded toward white
    expect([...d.overlay.slice(4, 8)]).toEqual([220, 38, 38, 255]);
    expect([...d.overlay.slice(0, 4)]).toEqual([241, 241, 241, 255]);
  });
  it("ignores small differences such as antialiasing", () => {
    const b = img(2, 2, [210, 200, 190]);
    const d = diffPixels(img(2, 2, [200, 200, 200]), b, 2, 2);
    expect(d.changed).toBe(0);
    expect(d.box).toBeNull();
    expect(diffPixels(img(2, 2, [200, 200, 200]), b, 2, 2, { threshold: 5 }).changed).toBe(4);
  });
  it("compares only the area both cover when the sizes differ", () => {
    const a = img(3, 2, [0, 0, 0]);
    const b = img(2, 2, [0, 0, 0]);
    set(a, 2, 0, [255, 255, 255]); // outside the shared area
    expect(diffPixels(a, b, 2, 2).changed).toBe(0);
  });
});

describe("changedText", () => {
  it("rounds to what reads well", () => {
    expect(changedText({ changed: 0, total: 100 })).toBe("none");
    expect(changedText({ changed: 1, total: 1_000_000 })).toBe("under 0.01%");
    expect(changedText({ changed: 5, total: 1000 })).toBe("0.50%");
    expect(changedText({ changed: 48, total: 1000 })).toBe("4.8%");
    expect(changedText({ changed: 250, total: 1000 })).toBe("25%");
  });
});
