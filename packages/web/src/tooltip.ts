// v-tip: a themed tooltip instead of the browser's `title` popup. One shared element on
// <body> shows the text above the element (below when there is no room) on hover or
// keyboard focus, and links it with aria-describedby while it is open.
import type { Directive } from "vue";
import { placePopup, viewport } from "./popup";

const DELAY_MS = 350;
const tipId = "ww-tip";

type Tipped = HTMLElement & { _tip?: { text: string; enter: () => void; leave: () => void; key: (e: KeyboardEvent) => void } };

let tipEl: HTMLDivElement | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let owner: HTMLElement | null = null;

function element(): HTMLDivElement {
  if (!tipEl) {
    tipEl = document.createElement("div");
    tipEl.id = tipId;
    tipEl.className = "ww-tip";
    tipEl.setAttribute("role", "tooltip");
    tipEl.hidden = true;
    document.body.append(tipEl);
  }
  return tipEl;
}

function show(el: Tipped) {
  const text = el._tip?.text;
  if (!text) return;
  const t = element();
  t.textContent = text;
  t.hidden = false;
  // Centered above the element, below when there is no room, kept on screen.
  const p = placePopup(el.getBoundingClientRect(), t.getBoundingClientRect(), viewport(), { side: "top", align: "center", gap: 6, margin: 4 });
  t.style.top = `${p.top}px`;
  t.style.left = `${p.left}px`;
  window.addEventListener("scroll", hide, { capture: true, once: true });
  owner = el;
  el.setAttribute("aria-describedby", tipId);
}

function hide() {
  clearTimeout(timer);
  if (tipEl) tipEl.hidden = true;
  owner?.removeAttribute("aria-describedby");
  owner = null;
}

export const vTip: Directive<HTMLElement, string | undefined> = {
  mounted(el: Tipped, binding) {
    const enter = () => {
      clearTimeout(timer);
      timer = setTimeout(() => show(el), DELAY_MS);
    };
    const leave = () => hide();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    el._tip = { text: binding.value ?? "", enter, leave, key };
    el.addEventListener("pointerenter", enter);
    el.addEventListener("pointerleave", leave);
    el.addEventListener("focusin", enter);
    el.addEventListener("focusout", leave);
    el.addEventListener("keydown", key);
  },
  updated(el: Tipped, binding) {
    if (!el._tip) return;
    el._tip.text = binding.value ?? "";
    if (owner === el) {
      if (el._tip.text) show(el);
      else hide();
    }
  },
  beforeUnmount(el: Tipped) {
    if (owner === el) hide();
    const t = el._tip;
    if (!t) return;
    el.removeEventListener("pointerenter", t.enter);
    el.removeEventListener("pointerleave", t.leave);
    el.removeEventListener("focusin", t.enter);
    el.removeEventListener("focusout", t.leave);
    el.removeEventListener("keydown", t.key);
    delete el._tip;
  },
};
