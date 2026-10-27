// Themes: a look (palette, fonts, corners) and a mode (light, dark or the system's).
// The values live in src/style.css under [data-look="…"]; this file only picks them.

export const LOOKS = [
  { id: "movement", name: "Movement", note: "Watchmaker's blue on porcelain" },
  { id: "drafting", name: "Drafting table", note: "Blueprint and safety orange" },
  { id: "onair", name: "On air", note: "Control room with a tally light" },
  { id: "nightwatch", name: "Night watch", note: "Dim and always dark, for overnight runs" },
  { id: "contrast", name: "High contrast", note: "Black and white, heavier lines" },
] as const;

export type Look = (typeof LOOKS)[number]["id"];
export type Mode = "system" | "light" | "dark";

export const MODES: { id: Mode; name: string }[] = [
  { id: "system", name: "System" },
  { id: "light", name: "Light" },
  { id: "dark", name: "Dark" },
];

export interface Theme {
  look: Look;
  mode: Mode;
}

export const DEFAULT_THEME: Theme = { look: "movement", mode: "system" };

const STORAGE_KEY = "watchwright.theme";

export type Store = Pick<Storage, "getItem" | "setItem">;

function isLook(value: unknown): value is Look {
  return LOOKS.some((l) => l.id === value);
}

function isMode(value: unknown): value is Mode {
  return MODES.some((m) => m.id === value);
}

/** Reads the saved theme. Anything missing or unknown falls back to the default. */
export function loadTheme(store: Store | null): Theme {
  try {
    const raw = store?.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_THEME };
    const saved = JSON.parse(raw) as { look?: unknown; mode?: unknown };
    return {
      look: isLook(saved.look) ? saved.look : DEFAULT_THEME.look,
      mode: isMode(saved.mode) ? saved.mode : DEFAULT_THEME.mode,
    };
  } catch {
    return { ...DEFAULT_THEME };
  }
}

/** Saves the theme. A browser that refuses storage keeps the theme for this page only. */
export function saveTheme(store: Store | null, theme: Theme): void {
  try {
    store?.setItem(STORAGE_KEY, JSON.stringify(theme));
  } catch {
    // Private windows and blocked site data throw here; the page still works.
  }
}

/** Puts the theme on the root element, where style.css reads it. */
export function applyTheme(root: { dataset: DOMStringMap }, theme: Theme): void {
  root.dataset.look = theme.look;
  if (theme.mode === "system") delete root.dataset.mode;
  else root.dataset.mode = theme.mode;
}

export function browserStore(): Store | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
