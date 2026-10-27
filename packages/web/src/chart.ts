// Math for the small charts (SparkLine, BarChart, StatTile): scales, clean axis ticks,
// compact numbers and SVG paths. No drawing here, so it is easy to test.

/** A linear map from `domain` to `range`. A flat domain maps everything to the middle. */
export function scale([d0, d1]: readonly [number, number], [r0, r1]: readonly [number, number]) {
  const span = d1 - d0;
  return (v: number) => (span === 0 ? (r0 + r1) / 2 : r0 + ((v - d0) / span) * (r1 - r0));
}

/** Round tick values from 0 (or `min`) up past `max`: 0, 5, 10, 15 or 0, 200, 400. */
export function niceTicks(max: number, count = 4, min = 0): number[] {
  if (!(max > min)) return [min, min + 1];
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag;
  const ticks: number[] = [];
  for (let v = Math.floor(min / step) * step; v < max + step; v += step) {
    ticks.push(Number(v.toFixed(10)));
    if (v >= max) break;
  }
  return ticks;
}

/** 1,284 / 12.9K / 4.2M, for values and ticks. */
export function compact(n: number): string {
  const abs = Math.abs(n);
  const short = (v: number, unit: string) => `${Number(v.toFixed(Math.abs(v) < 100 ? 1 : 0))}${unit}`;
  if (abs >= 1e9) return short(n / 1e9, "B");
  if (abs >= 1e6) return short(n / 1e6, "M");
  if (abs >= 1e4) return short(n / 1e3, "K");
  return n.toLocaleString("en-US", { maximumFractionDigits: abs < 10 ? 2 : 1 });
}

export type Point = readonly [number, number];

/** An SVG path through `points`. */
export function linePath(points: readonly Point[]): string {
  return points.map(([x, y], i) => `${i ? "L" : "M"}${round(x)},${round(y)}`).join("");
}

/** The area under `points` down to `base`, for a light wash below a line. */
export function areaPath(points: readonly Point[], base: number): string {
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return "";
  return `${linePath(points)}L${round(last[0])},${round(base)}L${round(first[0])},${round(base)}Z`;
}

/**
 * A column from the baseline up: square at the bottom, `r` rounded at the top. Height under
 * 2r keeps a smaller radius so a short bar is still a bar.
 */
export function columnPath(x: number, y: number, w: number, h: number, r = 4): string {
  if (h <= 0 || w <= 0) return "";
  const rr = Math.min(r, w / 2, h);
  const b = y + h;
  return `M${round(x)},${round(b)}V${round(y + rr)}Q${round(x)},${round(y)} ${round(x + rr)},${round(y)}H${round(x + w - rr)}Q${round(x + w)},${round(y)} ${round(x + w)},${round(y + rr)}V${round(b)}Z`;
}

/** The index of the slot under `x` when `n` slots share `width` evenly. */
export function slotAt(x: number, width: number, n: number): number {
  if (n <= 0) return -1;
  return Math.min(n - 1, Math.max(0, Math.floor((x / width) * n)));
}

const round = (v: number) => Math.round(v * 100) / 100;
