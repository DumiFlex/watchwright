import { describe, expect, it } from "vitest";
import { placePopup } from "../src/popup";

const vp = { width: 1000, height: 800 };
const at = (left: number, top: number, width = 200, height = 32) => ({ left, top, width, right: left + width, bottom: top + height });

describe("placePopup", () => {
  it("opens below the anchor, aligned to its start", () => {
    expect(placePopup(at(100, 100), { width: 200, height: 150 }, vp)).toEqual({ top: 136, left: 100, side: "bottom", maxHeight: 656 });
  });

  it("flips above when the bottom has less room than it needs and the top has more", () => {
    const p = placePopup(at(100, 700), { width: 200, height: 150 }, vp);
    expect(p.side).toBe("top");
    expect(p.top).toBe(700 - 4 - 150);
  });

  it("stays below when neither side fits but below has more room", () => {
    const p = placePopup(at(100, 300), { width: 200, height: 900 }, vp);
    expect(p).toMatchObject({ side: "bottom", top: 336, maxHeight: 456 });
  });

  it("caps a flipped popup to the room above", () => {
    const p = placePopup(at(100, 500), { width: 200, height: 900 }, vp);
    expect(p).toMatchObject({ side: "top", maxHeight: 488, top: 8 });
  });

  it("prefers the top for tooltips and falls back below", () => {
    const tip = { width: 100, height: 24 };
    expect(placePopup(at(200, 100, 60, 30), tip, vp, { side: "top", align: "center", gap: 6 })).toMatchObject({ side: "top", top: 70, left: 180 });
    expect(placePopup(at(200, 10, 60, 30), tip, vp, { side: "top", align: "center", gap: 6 })).toMatchObject({ side: "bottom", top: 46 });
  });

  it("keeps the popup inside the viewport horizontally", () => {
    expect(placePopup(at(950, 100, 40), { width: 280, height: 100 }, vp).left).toBe(1000 - 280 - 8);
    expect(placePopup(at(0, 100, 40), { width: 280, height: 100 }, vp, { align: "end" }).left).toBe(8);
    expect(placePopup(at(0, 100, 40), { width: 2000, height: 100 }, vp).left).toBe(8);
  });
});
