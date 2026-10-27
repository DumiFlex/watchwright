// The server's machine-wide settings (GET/POST /settings), loaded once and shared by every page.
import { reactive } from "vue";
import { getJson, sendJson } from "./api";
import type { Editor } from "./editor";

export interface Settings {
  "settings.editor": Editor;
  "runs.newRunFrom": "latest" | "defaults";
  [key: string]: unknown;
}

/** `home` is the server machine's home folder, for showing paths as ~/… */
export const settings = reactive<{ values: Settings; loaded: boolean; home: string | null }>({ values: { "settings.editor": "vscode", "runs.newRunFrom": "latest" }, loaded: false, home: null });

let loading: Promise<void> | null = null;

/** Loads the settings once; later calls reuse the first answer. */
export function loadSettings(force = false): Promise<void> {
  if (!loading || force) {
    loading = Promise.all([getJson<{ values: Settings }>("/api/v1/settings"), getJson<{ home: string }>("/api/v1/folders/places")]).then(([res, places]) => {
      if (res.ok) settings.values = res.data.values;
      if (places.ok) settings.home = places.data.home;
      settings.loaded = true;
    });
  }
  return loading;
}

/** Changes settings on the server; the shared copy follows its answer. Returns an error message or null. */
export async function saveSettings(values: Partial<Record<keyof Settings, unknown>>): Promise<string | null> {
  const res = await sendJson<{ values: Settings }>("/api/v1/settings", { values });
  if (!res.ok) return res.error.message;
  settings.values = res.data.values;
  return null;
}
