// Whether a newer Watchwright is out (`GET /updates`), shared by the top bar's note and Settings ›
// Server. The server asks npm now and then; this asks the server once per page load.
import { reactive } from "vue";
import { getJson } from "./api";

export type InstallKind = "npm" | "docker" | "npx" | "other";

export interface UpdateStatus {
  version: string;
  latest: string | null;
  newer: boolean;
  checkedAt: string | null;
  error: string | null;
  check: boolean;
  install: InstallKind;
  canUpdate: boolean;
  how: string;
  last: { from: string; to: string; ok: boolean; message: string; at: string } | null;
}

export const updates = reactive<{ status: UpdateStatus | null }>({ status: null });

export async function loadUpdates(refresh = false): Promise<string | null> {
  const res = await getJson<UpdateStatus>(`/api/v1/updates${refresh ? "?refresh=true" : ""}`);
  if (!res.ok) return res.error.message;
  updates.status = res.data;
  return null;
}

/** The release's notes on GitHub. */
export function notesUrl(version: string): string {
  return `https://github.com/DumiFlex/watchwright/releases/tag/v${version}`;
}
