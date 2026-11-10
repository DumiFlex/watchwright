// The server's settings (GET /settings), loaded once and shared by every page. `values` are as they
// apply to the person signed in (their own editor and New run choices); `server` are the
// server-wide values, which are also the defaults of the per-user ones.
import { reactive } from "vue";
import { getJson, sendJson } from "./api";
import type { Editor } from "./editor";

export interface Settings {
  "settings.editor": Editor;
  "runs.newRunFrom": "latest" | "defaults";
  /** The server builds packs again when their files change outside Watchwright. */
  "packs.watch": boolean;
  /** How live views come: a video stream (auto: when not on the server's machine) or JPEG frames. */
  "live.video": "auto" | "video" | "frames";
  [key: string]: unknown;
}

/** `home` is the server machine's home folder, for showing paths as ~/… */
const DEFAULTS: Settings = { "settings.editor": "vscode", "runs.newRunFrom": "latest", "packs.watch": true, "live.video": "auto" };
export const settings = reactive<{ values: Settings; server: Settings; loaded: boolean; home: string | null }>({ values: { ...DEFAULTS }, server: { ...DEFAULTS }, loaded: false, home: null });

let loading: Promise<void> | null = null;

/** Loads the settings once; later calls reuse the first answer. */
export function loadSettings(force = false): Promise<void> {
  if (!loading || force) {
    loading = Promise.all([getJson<{ values: Settings; server?: Settings }>("/api/v1/settings"), getJson<{ home: string }>("/api/v1/folders/places")]).then(([res, places]) => {
      if (res.ok) {
        settings.values = res.data.values;
        settings.server = res.data.server ?? res.data.values;
      }
      if (places.ok) settings.home = places.data.home;
      settings.loaded = true;
    });
  }
  return loading;
}

/** Changes server-wide settings (admins); the shared copy follows its answer. Returns an error message or null. */
export function saveSettings(values: Partial<Record<keyof Settings, unknown>>): Promise<string | null> {
  return send("/api/v1/settings", values);
}

/** Changes your own values of per-user settings (with login off, the server's). */
export function saveMine(values: Partial<Record<keyof Settings, unknown>>): Promise<string | null> {
  return send("/api/v1/settings/mine", values);
}

async function send(path: string, values: Partial<Record<keyof Settings, unknown>>): Promise<string | null> {
  const res = await sendJson<{ values: Settings; server?: Settings }>(path, { values });
  if (!res.ok) return res.error.message;
  settings.values = res.data.values;
  settings.server = res.data.server ?? res.data.values;
  return null;
}
