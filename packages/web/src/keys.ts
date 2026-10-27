// Keyboard shortcuts written as text, like "Mod+K" or "Shift+?": "Mod" is Cmd on a Mac and
// Ctrl elsewhere. `matches` checks an event against one, `keyParts` splits one for KeyHint,
// and `useShortcut` binds one on the window while a component is mounted.
import { onBeforeUnmount, onMounted } from "vue";

export const isMac = (platform = typeof navigator === "undefined" ? "" : navigator.platform) => /Mac|iPhone|iPad/.test(platform);

const MODIFIERS = ["Mod", "Ctrl", "Alt", "Shift"] as const;

/** The parts of a shortcut in display order: modifiers first, then the key. */
export function keyParts(combo: string): string[] {
  const parts = combo.split("+").map((p) => p.trim()).filter(Boolean);
  // "Shift++" names the plus key.
  if (combo.endsWith("++")) parts.push("+");
  return parts;
}

type KeyLike = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">;

/** Whether `e` is the shortcut `combo`. Letters ignore case; extra modifiers don't match. */
export function matches(e: KeyLike, combo: string, mac = isMac()): boolean {
  const parts = keyParts(combo);
  const key = parts.at(-1);
  if (!key) return false;
  const mods = new Set(parts.slice(0, -1));
  const wantCtrl = mods.has("Ctrl") || (mods.has("Mod") && !mac);
  const wantMeta = mods.has("Mod") && mac;
  if (e.ctrlKey !== wantCtrl || e.metaKey !== wantMeta || e.altKey !== mods.has("Alt")) return false;
  // Shift is part of typing "?" or "+", so it only counts when the shortcut names it on a letter.
  const letter = /^[a-z]$/i.test(key);
  if (letter && e.shiftKey !== mods.has("Shift")) return false;
  if (!letter && mods.has("Shift") && !e.shiftKey) return false;
  // "Space" names the space bar, whose key is " ".
  return e.key.toLowerCase() === (key === "Space" ? " " : key.toLowerCase());
}

/** Whether keys go into a text field (or similar) at `el`, where single-key shortcuts stay off. */
export function isTyping(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLElement && el.isContentEditable) return true;
  return el.matches("input:not([type=checkbox]):not([type=radio]), textarea, select, [role=combobox]");
}

export const isModifier = (part: string) => (MODIFIERS as readonly string[]).includes(part);

/**
 * Runs `run` when `combo` is pressed anywhere on the page. A shortcut without Mod, Ctrl or
 * Alt is skipped while a text field has focus, so typing "?" in a search box stays typing.
 */
export function useShortcut(combo: string, run: (e: KeyboardEvent) => void) {
  const chord = keyParts(combo).some((p) => p === "Mod" || p === "Ctrl" || p === "Alt");
  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || !matches(e, combo)) return;
    if (!chord && isTyping(document.activeElement)) return;
    e.preventDefault();
    run(e);
  };
  onMounted(() => window.addEventListener("keydown", onKey));
  onBeforeUnmount(() => window.removeEventListener("keydown", onKey));
}
