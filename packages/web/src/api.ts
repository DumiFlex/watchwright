// Talks to the Watchwright server. Shapes mirror packages/watchwright/src/server (docs/plan.md, section 8).

export interface HealthData {
  name: "watchwright";
  version: string;
  dataDir: string;
  plugins: { name: string; schemaVersion: number }[];
}

export interface ApiError {
  code: string;
  message: string;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

export async function getJson<T>(url: string, fetcher: typeof fetch = fetch): Promise<ApiResult<T>> {
  try {
    const res = await fetcher(url, { headers: { accept: "application/json" } });
    const body = (await res.json().catch(() => null)) as { data?: T; error?: ApiError } | null;
    if (res.ok && body && "data" in body) return { ok: true, data: body.data as T };
    return { ok: false, error: body?.error ?? { code: `http_${res.status}`, message: `The server answered ${res.status}.` } };
  } catch {
    return { ok: false, error: { code: "unreachable", message: "Can't reach the Watchwright server." } };
  }
}

/** The live WebSocket address for the page's own origin (http → ws, https → wss). */
export function liveUrl(location: Pick<Location, "protocol" | "host">): string {
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${location.host}/api/v1/live`;
}
