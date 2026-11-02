import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { spawn } from "node:child_process";
import { BUILTIN_PLUGINS } from "../core/builtin.js";
import { migrationsOf } from "../core/plugin.js";
import { DEFAULT_HOST, DEFAULT_PORT, LOOPBACK_HOSTS, resolveDataDir } from "../config.js";
import { LOGIN } from "../core/keys.js";
import { buildServer } from "../server/app.js";
import { publicAddresses } from "../server/guard.js";
import { openStore } from "../store/db.js";
import { VERSION } from "../version.js";
import { startInBackground } from "./background.js";
import { tokenHeader } from "./client.js";
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
      background: { type: "boolean" },
      auth: { type: "boolean" },
      "public-url": { type: "string", multiple: true },
      "trust-proxy": { type: "string", multiple: true },
    },
  });
  const port = values.port === undefined ? DEFAULT_PORT : Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`--port must be a whole number from 1 to 65535, got "${values.port}".`);
    return 1;
  }
  const host = values.host ?? process.env.WATCHWRIGHT_HOST ?? DEFAULT_HOST;
  const login = loginOptions(values, process.env);
  if (typeof login === "string") {
    console.error(login);
    return 1;
  }
  if (!LOOPBACK_HOSTS.includes(host) && !login.on) {
    console.error(`--host ${host} opens the server to other machines, so it needs login: add --auth (or set WATCHWRIGHT_AUTH=on). See https://dumiflex.github.io/watchwright/guide/safety`);
    return 1;
  }

  const shown = host === "::1" ? "[::1]" : host;
  const url = `http://${shown}:${port}/`;
  const folders = positionals;
  // Before the store opens: a second server on the same data folder would take over the first one's runs.
  const running = await watchwrightAt(url);
  if (running) return alreadyRunning(url, running, folders, !values["no-open"], after);
  if (values.background) {
    if (after) {
      console.error("--background is for serve only. Start the server with `watchwright serve --background`, then run the demo.");
      return 2;
    }
    const dataDir = resolveDataDir({ flag: values.data });
    const started = await startInBackground({ argv, url, dataDir, up: () => watchwrightAt(url) });
    if (!started.ok) {
      console.error(`Watchwright didn't start in the background. Its log (${started.log}) ends with:\n${started.output || "(nothing)"}`);
      return 1;
    }
    console.log(`Watchwright ${started.version} is running in the background at ${url} (process ${started.pid}).`);
    console.log(`Its output goes to ${started.log}. Stop it from Settings > Server in the web app.`);
    if (!values["no-open"]) openBrowser(url);
    return 0;
  }

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
  const app = await buildServer({ store, port, webRoot, plugins, stop: () => void shutdown(), login: login.on, publicUrls: login.publicUrls, trustProxy: login.trustProxy });
  // SIGHUP: the console window closed (Windows gives a few seconds), SIGBREAK: Ctrl+Break on Windows.
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"] as const) process.once(signal, () => void shutdown());

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
  const shownUrl = login.publicUrls[0] ? `${login.publicUrls[0].replace(/\/$/, "")}/` : url;
  console.log(`Watchwright ${VERSION} is running at ${shownUrl}${shownUrl === url ? "" : ` (listening on ${host}:${port})`}`);
  console.log(`Data folder: ${dataDir}`);
  if (login.on) {
    const code = app.watchwright.services.get(LOGIN).setupCode();
    if (code) console.log(`Login is on and there is no user yet. Create the first admin at ${shownUrl}#/setup?code=${code} (or run \`watchwright users add <name> --role admin\` on this machine).`);
    else console.log("Login is on.");
  }
  const api: ApiCall = (method, apiPath, body) =>
    app
      .inject({ method, url: `/api/v1${apiPath}`, headers: { host: `${shown}:${port}`, "x-watchwright-client": "cli", ...app.internalHeaders }, payload: body as object })
      .then((r) => r.json() as ApiReply);
  const packs = await addPacks(folders, (body) => api("POST", "/packs", body) as Promise<PackReply>);
  const page = after ? await after(api, packs) : null;
  if (page) console.log(`Watch it at ${url}${page}`);
  if (!values["no-open"]) openBrowser(`${url}${page ?? ""}`);
  return -1; // keep running
}

export interface LoginFlags {
  auth?: boolean | undefined;
  "public-url"?: string[] | undefined;
  "trust-proxy"?: string[] | undefined;
}

/** Login settings from the flags, else WATCHWRIGHT_AUTH, WATCHWRIGHT_PUBLIC_URL and WATCHWRIGHT_TRUST_PROXY; a message when one is wrong. */
export function loginOptions(flags: LoginFlags, env: NodeJS.ProcessEnv): { on: boolean; publicUrls: string[]; trustProxy: string[] } | string {
  const list = (v: string | undefined) => (v ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const envAuth = (env.WATCHWRIGHT_AUTH ?? "").trim().toLowerCase();
  if (envAuth && !["on", "off", "1", "0", "true", "false"].includes(envAuth)) return `WATCHWRIGHT_AUTH is on or off, not "${env.WATCHWRIGHT_AUTH}".`;
  const on = flags.auth ?? ["on", "1", "true"].includes(envAuth);
  const publicUrls = flags["public-url"]?.flatMap(list) ?? list(env.WATCHWRIGHT_PUBLIC_URL);
  const trustProxy = flags["trust-proxy"]?.flatMap(list) ?? list(env.WATCHWRIGHT_TRUST_PROXY);
  try {
    publicAddresses(publicUrls);
  } catch (err) {
    return (err as Error).message;
  }
  return { on, publicUrls, trustProxy };
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
    fetch(`${url}api/v1${apiPath}`, { method, headers: { "content-type": "application/json", "x-watchwright-client": "cli", ...tokenHeader(process.env) }, body: JSON.stringify(body) }).then((r) => r.json() as Promise<ApiReply>);
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
