// Zoom steps for the image viewer: scales relative to the image's own size. "Fit" is the scale
// that shows the whole image in the stage, never above the image's own size.

export const ZOOM_STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8] as const;
export const MIN_ZOOM = ZOOM_STEPS[0];
export const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1]!;

export interface Size {
  width: number;
  height: number;
}

/** The scale that fits `image` inside `box`, at most 1. */
export function fitScale(image: Size, box: Size): number {
  if (image.width <= 0 || image.height <= 0 || box.width <= 0 || box.height <= 0) return 1;
  return Math.min(1, box.width / image.width, box.height / image.height);
}

/** The next step up (dir 1) or down (dir -1) from `scale`; stays inside the steps. */
export function stepZoom(scale: number, dir: 1 | -1): number {
  const eps = 1e-6;
  if (dir > 0) return ZOOM_STEPS.find((s) => s > scale + eps) ?? MAX_ZOOM;
  return [...ZOOM_STEPS].reverse().find((s) => s < scale - eps) ?? MIN_ZOOM;
}

/** Zoom by a wheel's delta (Ctrl+wheel, a trackpad pinch): smooth, kept inside the steps' range. */
export function wheelZoom(scale: number, deltaY: number): number {
  const next = scale * Math.exp(-deltaY * 0.002);
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
}

/**
 * Where to scroll the stage after zooming so the point under `at` (stage coordinates, from
 * the stage's top left as shown) stays under it.
 */
export function keepPoint(scroll: { left: number; top: number }, at: { x: number; y: number }, from: number, to: number): { left: number; top: number } {
  const k = to / from;
  return { left: Math.max(0, (scroll.left + at.x) * k - at.x), top: Math.max(0, (scroll.top + at.y) * k - at.y) };
}

export const percent = (scale: number) => `${Math.round(scale * 100)}%`;
