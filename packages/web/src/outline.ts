// "On this page": the sections a view lists for getting around it, like the docs site's outline.
// A view calls useOutline while it is shown; PageOutline in the app shell shows the list in the
// right margin when there is room, else behind a button in the floating group at the bottom
// right, which also has Back to top and To the bottom on every long page.
import { onBeforeUnmount, shallowRef, watchEffect } from "vue";

export type OutlineItem = {
  /** The element to scroll to: a section's card or heading. */
  id: string;
  label: string;
  /** 2 indents it under the item before, as a subsection. */
  level?: 1 | 2;
  /** Runs before scrolling, to show what the item points at (open a tab, unfold a section). */
  open?: () => void;
  /** Extra room to leave above it, for something stuck to the top of the page above it (a search bar). */
  land?: () => number;
  /** For items that share one element (the tabs of a card): whether this one is showing. */
  on?: () => boolean;
};
export type Outline = { label: string; items: readonly OutlineItem[] };

/** The outline of the view on show, or null. */
export const outline = shallowRef<Outline | null>(null);

let owner = 0;
/** Lists the view's sections while it is mounted. `items` is reactive: it is read again when what it uses changes. */
export function useOutline(label: string, items: () => readonly OutlineItem[]): void {
  const me = ++owner;
  const stop = watchEffect(() => {
    if (owner === me) outline.value = { label, items: items() };
  });
  onBeforeUnmount(() => {
    stop();
    if (owner === me) outline.value = null;
  });
}

/** The top bar's height plus a gap: where a section lands when the outline scrolls to it. */
export const LAND_AT = 56 + 16;

/** Where the outline goes in the right margin, beside a page whose right edge is at `pageRight`; null when it doesn't fit. */
export function railPlace(viewportWidth: number, pageRight: number): { left: number; width: number } | null {
  const gap = 16;
  const width = Math.min(240, viewportWidth - pageRight - 2 * gap);
  return width >= 180 ? { left: Math.round(pageRight + gap), width: Math.floor(width) } : null;
}

/**
 * Whether the page is long enough for the jump buttons, and which ones do something:
 * `up` once it is scrolled down a bit, `down` while there is a good way left to go.
 */
export function jumps(scrollTop: number, viewportHeight: number, scrollHeight: number): { long: boolean; up: boolean; down: boolean } {
  const rest = scrollHeight - viewportHeight;
  const long = rest > viewportHeight / 2;
  const near = Math.min(240, viewportHeight / 3);
  return { long, up: long && scrollTop > near, down: long && rest - scrollTop > near };
}

/** The tops `sectionAt` reads: an item that shares its element with an earlier one counts once, through the first. */
export function outlineTops(items: readonly OutlineItem[], topOf: (id: string) => number | null): (number | null)[] {
  return items.map((x, i) => (items.findIndex((y) => y.id === x.id) < i ? null : topOf(x.id)));
}

/** The index of the item to mark among `items`, given the one `sectionAt` found: of items sharing its element, the one showing. */
export function markAmong(items: readonly OutlineItem[], at: number): number {
  const hit = items[at];
  if (!hit) return at;
  const showing = items.findIndex((x) => x.id === hit.id && x.on?.());
  return showing >= 0 ? showing : items.findIndex((x) => x.id === hit.id);
}
