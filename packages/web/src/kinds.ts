// The job kinds the server has loaded and the words each one uses for outcomes (`GET /kinds`):
// an extraction shows "done" where a test shows "passed". Loaded once per page.

import { reactive } from "vue";
import { getJson } from "./api";

export interface KindInfo {
  name: string;
  labels: Record<string, string>;
}

const labels = reactive(new Map<string, Record<string, string>>());
let loading: Promise<void> | null = null;

/** Fetches the kinds once; later calls reuse the first fetch. */
export function loadKinds(fetcher: typeof fetch = fetch): Promise<void> {
  loading ??= getJson<KindInfo[]>("/api/v1/kinds", fetcher).then((res) => {
    if (res.ok) for (const k of res.data) labels.set(k.name, k.labels);
    else loading = null;
  });
  return loading;
}

/** The word a kind uses for an outcome; the outcome itself when the kind has none (or isn't known). */
export function outcomeLabel(status: string, kind?: string): string {
  return (kind && labels.get(kind)?.[status]) || status;
}
