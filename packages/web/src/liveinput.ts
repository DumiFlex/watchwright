// Input on the live view for Record: where a pointer on the picture is in the page's own pixels,
// and keys in Playwright's names. The server sends them to the recording browser as they are.

export type ViewInput =
  | { type: "down" | "up"; x: number; y: number; button: "left" | "middle" | "right"; clickCount: number }
  | { type: "move"; x: number; y: number }
  | { type: "wheel"; x: number; y: number; deltaX: number; deltaY: number }
  | { type: "key"; key: string }
  | { type: "text"; text: string };

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}
interface Size {
  width: number;
  height: number;
}

/**
 * The page point under a pointer on a canvas that shows a frame with `object-fit: contain`: the
 * frame is scaled to fit and centred, so the bars beside or above it are outside the page (null).
 * `frame` is the picture's size in pixels, `page` the page's viewport (the frame may be smaller).
 */
export function pagePoint(box: Rect, frame: Size, page: Size, clientX: number, clientY: number): { x: number; y: number } | null {
  if (box.width <= 0 || box.height <= 0 || frame.width <= 0 || frame.height <= 0) return null;
  const scale = Math.min(box.width / frame.width, box.height / frame.height);
  const ox = (box.width - frame.width * scale) / 2;
  const oy = (box.height - frame.height * scale) / 2;
  const fx = (clientX - box.left - ox) / scale;
  const fy = (clientY - box.top - oy) / scale;
  if (fx < 0 || fy < 0 || fx > frame.width || fy > frame.height) return null;
  const round = (n: number) => Math.round(n * 10) / 10;
  return { x: round((fx * page.width) / frame.width), y: round((fy * page.height) / frame.height) };
}

const MODIFIER_KEYS = new Set(["Control", "Alt", "Shift", "Meta", "CapsLock", "Dead", "Unidentified", "Process"]);

/**
 * A key press in Playwright's form, or null for one that isn't sent on its own (a modifier).
 * Printable characters go as they are (`A` already says Shift); with Control, Alt or Meta held,
 * or for named keys, the held modifiers come first: `Control+a`, `Shift+Tab`.
 */
export function keyOf(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">): string | null {
  if (!e.key || MODIFIER_KEYS.has(e.key)) return null;
  const printable = e.key.length === 1;
  const name = e.key === " " ? "Space" : e.key;
  if (printable && !e.ctrlKey && !e.altKey && !e.metaKey) return name;
  const mods = [e.ctrlKey && "Control", e.altKey && "Alt", e.metaKey && "Meta", e.shiftKey && "Shift"].filter((m): m is string => typeof m === "string");
  return [...mods, printable ? name.toLowerCase() : name].join("+");
}
