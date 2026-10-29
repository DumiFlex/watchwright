import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { spawn } from "node:child_process";
import { BUILTIN_PLUGINS } from "../core/builtin.js";
import { migrationsOf } from "../core/plugin.js";
import { DEFAULT_HOST, DEFAULT_PORT, LOOPBACK_HOSTS, resolveDataDir } from "../config.js";
import { buildServer } from "../server/app.js";
import { openStore } from "../store/db.js";
import { VERSION } from "../version.js";
import { hideChildWindows } from "./hide-windows.js";

// `watchwright serve`: the long-lived server (the web app, the HTTP API and the store).

/** Calls the server's API: a path under /api/v1 and a JSON body. */
export type ApiCall = (method: "POST", path: string, body: unknown) => Promise<ApiReply>;
export type ApiReply = { data?: Record<string, unknown>; error?: { message: string } };

/**
 * Work for once the server answers and the packs are added (`watchwright demo` starts a run):
 * gets each pack's reply, returns the page to open (a hash such as `#/runs/0a1b2c3d`) or null.
 */
export type AfterStart = (api: ApiCall, packs: PackReply[]) => Promise<string | null>;

/** Starts the server; resolves to an exit code, or -1 while it keeps running. */
export async function serveCommand(argv: string[], after?: AfterStart): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      port: { type: "string" },
      host: { type: "string" },
      data: { type: "string" },
      "no-open": { type: "boolean" },
    },
  });
  const port = values.port === undefined ? DEFAULT_PORT : Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`--port must be a whole number from 1 to 65535, got "${values.port}".`);
    return 1;
  }
  const host = values.host ?? DEFAULT_HOST;
  if (!LOOPBACK_HOSTS.includes(host)) {
    console.error(`--host ${host} would open the server to other machines. That needs token auth, which isn't built yet; use 127.0.0.1.`);
    return 1;
  }

  const shown = host === "::1" ? "[::1]" : host;
  const url = `http://${shown}:${port}/`;
  const folders = positionals;
  // Before the store opens: a second server on the same data folder would take over the first one's runs.
  const running = await watchwrightAt(url);
  if (running) return alreadyRunning(url, running, folders, !values["no-open"], after);

  // Before anything starts a child process (a browser, ffmpeg, a pack's commands).
  hideChildWindows();
  const dataDir = resolveDataDir({ flag: values.data });
  const plugins = BUILTIN_PLUGINS;
  const store = openStore(dataDir, migrationsOf(plugins));
  const webRoot = fileURLToPath(new URL("../web/", import.meta.url));
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    console.log("Stopping Watchwright…");
    await app.close();
    store.close();
    process.exit(0);
  };
  const app = await buildServer({ store, port, webRoot, plugins, stop: () => void shutdown() });
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());

  // Playwright can throw from its own message loop when a browser goes away mid-call (a run
  // stopped at the wrong moment). That must not take the server and every other run down with it.
  process.on("uncaughtException", (err) => {
    if (/was not bound in the connection|Cannot find object to/.test(err.message)) {
      console.error(`Ignored a Playwright error after a browser closed: ${err.message}`);
      return;
    }
    console.error(err);
    process.exit(1);
  });

  try {
    await app.listen({ port, host });
  } catch (err) {
    await app.close();
    store.close();
    if ((err as NodeJS.ErrnoException).code !== "EADDRINUSE") throw err;
    console.error(`Port ${port} is taken by another program. Start Watchwright on another port with --port, for example --port ${port + 1}.`);
    return 1;
  }
  console.log(`Watchwright ${VERSION} is running at ${url}`);
  console.log(`Data folder: ${dataDir}`);
  const api: ApiCall = (method, apiPath, body) =>
    app
      .inject({ method, url: `/api/v1${apiPath}`, headers: { host: `${shown}:${port}`, "x-watchwright-client": "cli" }, payload: body as object })
      .then((r) => r.json() as ApiReply);
  const packs = await addPacks(folders, (body) => api("POST", "/packs", body) as Promise<PackReply>);
  const page = after ? await after(api, packs) : null;
  if (page) console.log(`Watch it at ${url}${page}`);
  if (!values["no-open"]) openBrowser(`${url}${page ?? ""}`);
  return -1; // keep running
}

export type PackReply = { data?: { id: string; name: string; dir?: string; path: string; status: string; error: string | null }; error?: { message: string } };

/** Adds each pack folder through the API and says how it went. */
async function addPacks(folders: string[], post: (body: { path: string }) => Promise<PackReply>): Promise<PackReply[]> {
  const replies: PackReply[] = [];
  for (const f of folders) {
    // relative folders are relative to where the command runs; the server cleans up the rest
    const res = await post({ path: path.isAbsolute(f) || /^(file:|~|["'])/i.test(f) ? f : path.resolve(f) }).catch((err: unknown) => ({ error: { message: err instanceof Error ? err.message : String(err) } }) as PackReply);
    if (res.data) console.log(`Pack "${res.data.name}" (${res.data.dir ?? res.data.path})${res.data.status === "ok" ? "" : `: ${res.data.error ?? "doesn't load"}`}`);
    else console.error(`Couldn't add ${f}: ${res.error?.message ?? "no answer"}`);
    replies.push(res);
  }
  return replies;
}

/** The version of the Watchwright answering at `url`, or null when nothing (or something else) does. */
async function watchwrightAt(url: string): Promise<string | null> {
  const health = await fetch(`${url}api/v1/health`, { signal: AbortSignal.timeout(2000) })
    .then((r) => r.json() as Promise<{ data?: { name?: string; version?: string } }>)
    .catch(() => null);
  return health?.data?.name === "watchwright" ? (health.data.version ?? "") : null;
}

/** Watchwright already runs on the port: add the packs there and open its page. */
async function alreadyRunning(url: string, version: string, folders: string[], open: boolean, after?: AfterStart): Promise<number> {
  console.log(`Watchwright ${version} is already running at ${url}`);
  const api: ApiCall = (method, apiPath, body) =>
    fetch(`${url}api/v1${apiPath}`, { method, headers: { "content-type": "application/json", "x-watchwright-client": "cli" }, body: JSON.stringify(body) }).then((r) => r.json() as Promise<ApiReply>);
  const packs = await addPacks(folders, (body) => api("POST", "/packs", body) as Promise<PackReply>);
  const page = after ? await after(api, packs) : null;
  if (page) console.log(`Watch it at ${url}${page}`);
  if (open) openBrowser(`${url}${page ?? ""}`);
  return 0;
}

/** Opens the web page in the default browser. Failing to open it is not an error: the address is printed. */
export function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true });
    child.on("error", () => undefined);
    child.unref();
  } catch {
    // no opener on this system
  }
}
