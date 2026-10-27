// The tab's title and icon. A page that watches something (a run) sets both, so a tab in the
// background still says how it's going; every page resets them when it leaves.
import type { Tone } from "./runstate";

const BASE_TITLE = "Watchwright";
let baseIcon: Promise<string | null> | null = null;
let shown: Tone | null = null;

export function setTitle(text?: string | null): void {
  document.title = text || BASE_TITLE;
}

/** A token color resolved for the current look and mode, as rgb(). */
function tokenColor(tone: Tone): string {
  const probe = document.createElement("span");
  probe.style.color = `var(--${tone})`;
  probe.hidden = true;
  document.body.append(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color;
}

function link(): HTMLLinkElement {
  let el = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!el) {
    el = document.createElement("link");
    el.rel = "icon";
    document.head.append(el);
  }
  return el;
}

/** Puts a dot in the tone's color on the favicon, or takes it away (null). */
export async function setIconDot(tone: Tone | null): Promise<void> {
  if (tone === shown) return;
  shown = tone;
  const el = link();
  if (!tone) {
    el.type = "image/svg+xml";
    el.href = "/favicon.svg";
    return;
  }
  baseIcon ??= fetch("/favicon.svg")
    .then((r) => (r.ok ? r.text() : null))
    .catch(() => null);
  const svg = await baseIcon;
  if (!svg || shown !== tone) return;
  const dot = `<circle cx="25" cy="25" r="7" fill="${tokenColor(tone)}" stroke="#fff" stroke-width="2"/>`;
  el.type = "image/svg+xml";
  el.href = `data:image/svg+xml,${encodeURIComponent(svg.replace(/<\/svg>\s*$/, `${dot}</svg>`))}`;
}

export function resetHead(): void {
  setTitle(null);
  void setIconDot(null);
}
