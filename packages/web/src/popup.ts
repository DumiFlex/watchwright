// Positioning for everything that pops up next to an anchor: lists, calendars, menus and
// tooltips. Popups are teleported to <body> and placed with position: fixed, so a card
// with overflow: hidden never clips them. They open on the preferred side, flip when the
// other side has more room and stay inside the viewport. The room left on their side is
// in the CSS variable --popup-room, for `max-height: min(240px, var(--popup-room))`.
import { computed, onBeforeUnmount, onMounted, ref, shallowReactive, shallowRef, watch, type Ref } from "vue";

export type Side = "bottom" | "top";
export type Align = "start" | "center" | "end";
export type PlaceOptions = { side?: Side; align?: Align; gap?: number; margin?: number };
type Rect = { top: number; bottom: number; left: number; right: number; width: number };
type Size = { width: number; height: number };

/** Where a popup of `size` goes next to `anchor` in a viewport of `vp` (all in CSS pixels). */
export function placePopup(anchor: Rect, size: Size, vp: Size, opts: PlaceOptions = {}) {
  const { gap = 4, margin = 8, align = "start" } = opts;
  const below = vp.height - anchor.bottom - gap - margin;
  const above = anchor.top - gap - margin;
  let side: Side = opts.side ?? "bottom";
  if (side === "bottom" && size.height > below && above > below) side = "top";
  else if (side === "top" && size.height > above && below > above) side = "bottom";
  const room = Math.max(0, side === "bottom" ? below : above);
  const height = Math.min(size.height, room);
  const top = side === "bottom" ? anchor.bottom + gap : anchor.top - gap - height;
  const want = align === "start" ? anchor.left : align === "end" ? anchor.right - size.width : anchor.left + anchor.width / 2 - size.width / 2;
  const left = size.width > vp.width - 2 * margin ? margin : Math.min(Math.max(margin, want), vp.width - size.width - margin);
  return { top, left, side, maxHeight: room };
}

export function viewport(): Size {
  return { width: document.documentElement.clientWidth, height: window.innerHeight };
}

/**
 * Keeps `popup` placed next to `anchor` while `open` is true, following scrolls and
 * resizes. `matchWidth` makes the popup as wide as its anchor (lists under a field).
 */
export function usePopup(anchor: Ref<HTMLElement | null>, popup: Ref<HTMLElement | null>, open: Ref<boolean>, opts: PlaceOptions & { matchWidth?: boolean } = {}) {
  const style = ref<Record<string, string>>({ position: "fixed", top: "0px", left: "0px" });
  const side = ref<Side>(opts.side ?? "bottom");
  let frame = 0;

  // After the first placement the popup keeps its side while it still fits, so a list that
  // shrinks or grows as you type doesn't jump from one side of its field to the other.
  let placed = false;
  function update() {
    const a = anchor.value;
    const p = popup.value;
    if (!a || !p) return;
    const r = a.getBoundingClientRect();
    const width = opts.matchWidth ? `${r.width}px` : "";
    p.style.width = width; // measure at the width it will have
    const at = placePopup(r, { width: p.offsetWidth, height: p.offsetHeight }, viewport(), placed ? { ...opts, side: side.value } : opts);
    placed = true;
    side.value = at.side;
    style.value = { position: "fixed", top: `${at.top}px`, left: `${at.left}px`, "--popup-room": `${at.maxHeight}px`, ...(width ? { width } : {}) };
  }
  const schedule = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(update);
  };
  let observer: ResizeObserver | undefined;
  function listen(on: boolean) {
    observer?.disconnect();
    observer = undefined;
    if (on) {
      window.addEventListener("scroll", schedule, true);
      window.addEventListener("resize", schedule);
      // Content that changes size (a filtered list) is placed again.
      if (popup.value) {
        observer = new ResizeObserver(schedule);
        observer.observe(popup.value);
      }
    } else {
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
    }
  }

  // flush: "post" runs after the popup is in the DOM and before the browser paints, so it
  // never shows at the wrong place and can take focus as soon as the caller's nextTick ends.
  watch(
    open,
    (isOpen) => {
      listen(false);
      placed = false;
      if (!isOpen) return;
      update();
      listen(true);
    },
    { immediate: true, flush: "post" },
  );
  onBeforeUnmount(() => {
    listen(false);
    cancelAnimationFrame(frame);
  });
  return { style, side, update };
}

/** Calls `close` on a pointerdown outside every element in `inside` while `open` is true. */
export function useOutside(inside: Ref<HTMLElement | null>[], open: Ref<boolean>, close: () => void) {
  const onDown = (e: PointerEvent) => {
    if (!open.value) return;
    const t = e.target as Node;
    if (!inside.some((r) => r.value?.contains(t))) close();
  };
  watch(
    open,
    (isOpen) => {
      if (isOpen) document.addEventListener("pointerdown", onDown, true);
      else document.removeEventListener("pointerdown", onDown, true);
    },
    { immediate: true },
  );
  onBeforeUnmount(() => document.removeEventListener("pointerdown", onDown, true));
}

/** Open modal dialogs, innermost last. ModalDialog keeps it; ToastHost follows the top one. */
export const openModals = shallowReactive<HTMLDialogElement[]>([]);

// The page behind an open modal doesn't scroll: a wheel over a dialog that has nothing left to
// scroll would otherwise scroll the page. The scrollbar's width is kept as padding so nothing shifts.
if (typeof document !== "undefined") {
  watch(
    () => openModals.length > 0,
    (locked) => {
      const root = document.documentElement;
      if (locked) {
        root.style.setProperty("--scrollbar-gap", `${window.innerWidth - root.clientWidth}px`);
        root.classList.add("ww-modal-open");
      } else root.classList.remove("ww-modal-open");
    },
  );
}

/** The element shown full screen, if any. Only what is inside it is drawn while it is. */
export const fullscreenElement = shallowRef<Element | null>(null);
if (typeof document !== "undefined") document.addEventListener("fullscreenchange", () => (fullscreenElement.value = document.fullscreenElement));

/** Where a popup for an element goes when it isn't in a modal: the full-screen element around it, or <body>. */
export function pageHost(el: Element | null): HTMLElement {
  const fs = document.fullscreenElement;
  return fs instanceof HTMLElement && el && fs.contains(el) ? fs : document.body;
}

/**
 * Where to teleport a popup: <body>; the popup holder of the modal <dialog> around `root` when
 * there is one, because a modal dialog sits in the top layer and makes everything outside it
 * inert; or the element shown full screen around `root`, because nothing outside it is drawn.
 */
export function usePopupHost(root: Ref<HTMLElement | null>) {
  const dialogHost = ref<HTMLElement | null>(null);
  onMounted(() => {
    const dialog = root.value?.closest("dialog");
    dialogHost.value = dialog ? (dialog.querySelector<HTMLElement>(":scope > .dlg-popups") ?? dialog) : null;
  });
  return computed<string | HTMLElement>(() => {
    if (dialogHost.value) return dialogHost.value;
    const fs = fullscreenElement.value;
    return fs instanceof HTMLElement && root.value && fs.contains(root.value) ? fs : "body";
  });
}
