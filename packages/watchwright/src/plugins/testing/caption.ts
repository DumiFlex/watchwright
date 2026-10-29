import type { Page } from "playwright";

// The step caption: with `run.chapters`, each `h.step` title (after the titles of the steps it
// runs in, as in the run page's status line) shows as a small label in the
// bottom-left corner of the live view and the video for a moment. Playwright's own chapter card
// (`screencast.showChapter`) blurs and dims the whole page and holds the test while it shows, so
// the caption is a plain overlay instead: it doesn't wait, the page stays readable, and the
// action titles (top right, `showActions`) keep their corner. Overlays are drawn into the page,
// so screenshots taken by `h` hide the caption first.

/** How long a caption stays, in ms, unless the next step replaces it sooner. */
export const CAPTION_MS = 2500;

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** The overlay HTML for a caption reading `title`. */
export function captionHtml(title: string): string {
  const text = title.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
  const style = [
    "position:absolute",
    "left:16px",
    "bottom:16px",
    "max-width:min(640px,calc(100% - 32px))",
    "padding:6px 12px",
    "border-radius:6px",
    "background:rgba(0,0,0,0.72)",
    "color:#fff",
    "font:600 14px/1.4 system-ui,-apple-system,sans-serif",
    "white-space:nowrap",
    "overflow:hidden",
    "text-overflow:ellipsis",
    "box-shadow:0 2px 8px rgba(0,0,0,0.3)",
    "pointer-events:none",
  ].join(";");
  return `<div style="${style}">${text}</div>`;
}

/** One caption at a time on a page: `show` replaces the one showing, `hide` removes it. */
export function stepCaptions(page: Page) {
  let current: { dispose: () => Promise<void>; timer: ReturnType<typeof setTimeout> } | null = null;
  let shown = 0;
  const hide = async () => {
    const c = current;
    current = null;
    if (!c) return;
    clearTimeout(c.timer);
    await c.dispose().catch(() => undefined);
  };
  return {
    async show(title: string): Promise<void> {
      await hide();
      const ticket = ++shown;
      const overlay = await page.screencast.showOverlay(captionHtml(title)).catch(() => null);
      if (!overlay) return;
      const dispose = () => overlay.dispose().catch(() => undefined);
      if (ticket !== shown) {
        await dispose();
        return;
      }
      const timer = setTimeout(() => {
        if (current?.timer === timer) void hide();
      }, CAPTION_MS);
      timer.unref?.();
      current = { dispose, timer };
    },
    hide,
  };
}
