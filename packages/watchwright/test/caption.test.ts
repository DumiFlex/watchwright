import type { Page } from "playwright";
import { describe, expect, it, vi } from "vitest";
import { CAPTION_MS, captionHtml, stepCaptions } from "../src/plugins/testing/caption.js";

function fakePage() {
  const shown: string[] = [];
  const removed: string[] = [];
  const page = {
    screencast: {
      showOverlay: async (html: string) => {
        shown.push(html);
        return { dispose: async () => void removed.push(html) };
      },
    },
  } as unknown as Page;
  return { page, shown, removed };
}

describe("step caption", () => {
  it("is a small corner label, not a full-page card, and escapes the title", () => {
    const html = captionHtml(`<b>"keep" & 'answer'</b>`);
    expect(html).toContain("&lt;b&gt;&quot;keep&quot; &amp; &#39;answer&#39;&lt;/b&gt;");
    expect(html).toContain("left:16px");
    expect(html).toContain("bottom:16px");
    expect(html).not.toContain("inset");
    expect(html).not.toContain("blur");
  });

  it("shows one caption at a time and removes it after a moment", async () => {
    vi.useFakeTimers();
    try {
      const { page, shown, removed } = fakePage();
      const c = stepCaptions(page);
      await c.show("open");
      await c.show("ask");
      expect(shown).toHaveLength(2);
      expect(removed).toEqual([shown[0]]);
      await vi.advanceTimersByTimeAsync(CAPTION_MS);
      expect(removed).toEqual([shown[0], shown[1]]);
      await c.hide();
      expect(removed).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never fails the step when the page can't show it", async () => {
    const page = { screencast: { showOverlay: async () => Promise.reject(new Error("closed")) } } as unknown as Page;
    await expect(stepCaptions(page).show("x")).resolves.toBeUndefined();
  });
});
