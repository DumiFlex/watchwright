// Pixel diff for two screenshots: how many pixels changed, where, and an overlay that shows the
// changed pixels strongly over a faded copy of the newer image. Pure, so it runs on any RGBA
// buffers (a canvas's ImageData in the page, plain arrays in tests).

/** How far apart (0 to 255, the largest channel difference) two pixels must be to count as changed; below it is antialiasing and compression noise. */
export const THRESHOLD = 24;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PixelDiff {
  width: number;
  height: number;
  changed: number;
  total: number;
  /** The smallest box around every changed pixel, or null when nothing changed. */
  box: Box | null;
  /** RGBA: the newer image faded, with changed pixels in `mark`. */
  overlay: Uint8ClampedArray;
}

/**
 * Compares the area both images cover (the top-left `width` × `height`); a size difference is
 * reported by the caller. `fade` (0 to 1) is how much of the newer image shows under the marks.
 */
export function diffPixels(
  a: { data: ArrayLike<number>; width: number },
  b: { data: ArrayLike<number>; width: number },
  width: number,
  height: number,
  o: { threshold?: number; mark?: readonly [number, number, number]; fade?: number; ground?: readonly [number, number, number] } = {},
): PixelDiff {
  const threshold = o.threshold ?? THRESHOLD;
  const [mr, mg, mb] = o.mark ?? [220, 38, 38];
  const [gr, gg, gb] = o.ground ?? [255, 255, 255];
  const fade = o.fade ?? 0.25;
  const overlay = new Uint8ClampedArray(width * height * 4);
  let changed = 0;
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * a.width + x) * 4;
      const j = (y * b.width + x) * 4;
      const o4 = (y * width + x) * 4;
      const d = Math.max(
        Math.abs((a.data[i] ?? 0) - (b.data[j] ?? 0)),
        Math.abs((a.data[i + 1] ?? 0) - (b.data[j + 1] ?? 0)),
        Math.abs((a.data[i + 2] ?? 0) - (b.data[j + 2] ?? 0)),
        Math.abs((a.data[i + 3] ?? 255) - (b.data[j + 3] ?? 255)),
      );
      if (d > threshold) {
        changed++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
        overlay[o4] = mr;
        overlay[o4 + 1] = mg;
        overlay[o4 + 2] = mb;
      } else {
        overlay[o4] = gr + ((b.data[j] ?? 0) - gr) * fade;
        overlay[o4 + 1] = gg + ((b.data[j + 1] ?? 0) - gg) * fade;
        overlay[o4 + 2] = gb + ((b.data[j + 2] ?? 0) - gb) * fade;
      }
      overlay[o4 + 3] = 255;
    }
  }
  return { width, height, changed, total: width * height, box: x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }, overlay };
}

/** "4.8%", "0.02%", "under 0.01%" or "none": the share of pixels that changed. */
export function changedText(d: Pick<PixelDiff, "changed" | "total">): string {
  if (d.changed === 0) return "none";
  const pct = (d.changed / Math.max(1, d.total)) * 100;
  if (pct < 0.01) return "under 0.01%";
  return `${pct < 1 ? pct.toFixed(2) : pct < 10 ? pct.toFixed(1) : Math.round(pct)}%`;
}
