import type { ActionInfo } from "../actions/registry.js";
import { DEFAULT_PORT } from "../config.js";

// The CLI's (and the stdio MCP bridge's) way to a running server: the address, who is calling,
// and calls by action, so every plugin's actions work without the client knowing them.

export const DEFAULT_SERVER = `http://127.0.0.1:${DEFAULT_PORT}/`;

/** The server's address from `--server`, else WATCHWRIGHT_URL, else the default; always ending in `/`. */
export function serverUrl(flag: string | undefined, env: NodeJS.ProcessEnv = process.env): string {
  let url = flag ?? env.WATCHWRIGHT_URL ?? DEFAULT_SERVER;
  if (/^\d+$/.test(url)) url = `http://127.0.0.1:${url}/`;
  if (!/^https?:\/\//.test(url)) url = `http://${url}`;
  return url.endsWith("/") ? url : `${url}/`;
}

/** Agents whose shells can be told from their environment, first match wins. */
const AGENTS: [string, (env: NodeJS.ProcessEnv) => boolean][] = [
  ["Claude Code", (e) => e.CLAUDECODE !== undefined],
  ["Codex", (e) => e.CODEX_THREAD_ID !== undefined],
  ["Gemini CLI", (e) => e.GEMINI_CLI === "1"],
  ["Cursor", (e) => e.CURSOR_TRACE_ID !== undefined && e.PAGER === "head -n 10000 | cat"],
  ["Amp", (e) => e.AMP_CURRENT_THREAD_ID !== undefined || e.AGENT === "amp"],
  ["OpenCode", (e) => e.OPENCODE !== undefined],
];

/** Who the CLI says is calling: `--as`, else WATCHWRIGHT_CLIENT, else the agent it runs under, else `cli`. */
export function clientName(flag: string | undefined, env: NodeJS.ProcessEnv = process.env): string {
  const given = flag ?? env.WATCHWRIGHT_CLIENT;
  if (given?.trim()) return given.trim().slice(0, 60);
  return AGENTS.find(([, test]) => test(env))?.[0] ?? "cli";
}

/** Nothing answers at the address, or something that isn't Watchwright does. */
export class NoServer extends Error {}

/** The server answered with its error envelope. */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly detail?: unknown,
  ) {
    super(message);
  }
}

export interface Health {
  name: "watchwright";
  version: string;
  dataDir: string;
}

export class Client {
  private actions: ActionInfo[] | null = null;

  constructor(
    readonly base: string,
    readonly client: string,
  ) {}

  /** The server's health, or null when no Watchwright answers. */
  async health(timeoutMs = 2000): Promise<Health | null> {
    const res = await fetch(`${this.base}api/v1/health`, { signal: AbortSignal.timeout(timeoutMs) }).catch(() => null);
    if (!res) return null;
    const body = (await res.json().catch(() => null)) as { data?: Health } | null;
    return body?.data?.name === "watchwright" ? body.data : null;
  }

  /** A request to `/api/v1<path>`; resolves to `data`, throws ApiError or NoServer. */
  async request<T>(method: string, path: string, input: Record<string, unknown> = {}, signal?: AbortSignal, confirmed = false): Promise<T> {
    let url = `${this.base}api/v1${path}`;
    let body: string | undefined;
    if (method === "GET" || method === "DELETE") {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(input)) if (v !== undefined) qs.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
      if ([...qs].length) url += `?${qs}`;
    } else body = JSON.stringify(input);
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: { "x-watchwright-client": this.client, ...(confirmed ? { "x-watchwright-confirmed": "terminal" } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
        ...(body !== undefined ? { body } : {}),
        ...(signal ? { signal } : {}),
      });
    } catch (err) {
      if (signal?.aborted) throw err;
      throw new NoServer(`No Watchwright answers at ${this.base}. Start it with \`watchwright serve\`, or point at another one with --server or WATCHWRIGHT_URL.`);
    }
    const json = (await res.json().catch(() => null)) as { data?: T; error?: { code: string; message: string; detail?: unknown } } | null;
    if (!json) throw new NoServer(`Something that isn't Watchwright answers at ${this.base}.`);
    if (json.error) throw new ApiError(json.error.code, json.error.message, res.status, json.error.detail);
    return json.data as T;
  }

  /** Every action the server has. */
  async listActions(): Promise<ActionInfo[]> {
    this.actions ??= await this.request<ActionInfo[]>("GET", "/actions");
    return this.actions;
  }

  async action(name: string): Promise<ActionInfo | undefined> {
    return (await this.listActions()).find((a) => a.name === name);
  }

  /** Calls an action: path parameters go into the path, the rest into the query or body. `confirmed`: a person said yes at a terminal. */
  call<T = unknown>(a: ActionInfo, input: Record<string, unknown>, signal?: AbortSignal, confirmed = false): Promise<T> {
    const rest = { ...input };
    const path = a.path.replace(/^\/api\/v1/, "").replace(/:([a-zA-Z]+)/g, (_, p: string) => {
      const v = rest[p];
      delete rest[p];
      if (v === undefined) throw new ApiError("bad_input", `${a.name} needs ${p}.`, 400);
      return encodeURIComponent(String(v));
    });
    return this.request<T>(a.method, path, rest, signal, confirmed);
  }

  /** Calls an action by name. */
  async callName<T = unknown>(name: string, input: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
    const a = await this.action(name);
    if (!a) throw new ApiError("unknown_action", `This server has no action ${name}; it may be older than this command.`, 404);
    return this.call<T>(a, input, signal);
  }
}

interface PackInfo {
  id: string;
  name: string;
  dir?: string;
  path: string;
}

const PACK_ID = /^[0-9a-f]{8}$/;

/** A pack id from an id, a pack's name or its folder; throws with the choices when it matches none or several. */
export async function resolvePack(client: Client, ref: string): Promise<{ id: string; name: string; guessed: boolean }> {
  const packs = await client.callName<PackInfo[]>("packs.list");
  if (PACK_ID.test(ref)) {
    const p = packs.find((x) => x.id === ref);
    if (p) return { id: p.id, name: p.name, guessed: false };
  }
  const norm = (s: string) => s.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const want = norm(ref);
  const hits = packs.filter((p) => p.name.toLowerCase() === ref.toLowerCase() || norm(p.dir ?? "") === want || norm(p.path) === want || norm(p.dir ?? "").endsWith(`/${want}`));
  if (hits.length === 1) return { id: hits[0]!.id, name: hits[0]!.name, guessed: true };
  const list = packs.map((p) => `${p.id} ${p.name}`).join(", ") || "none";
  throw new ApiError(hits.length ? "ambiguous" : "not_found", `${hits.length ? "Several packs match" : "No pack matches"} "${ref}". Packs: ${list}.`, 404);
}
