import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { ActionError, defineAction } from "../../actions/registry.js";
import { DEFAULT_HOST, DEFAULT_PORT } from "../../config.js";
import { definePlugin } from "../../core/plugin.js";
import { serviceKey } from "../../core/services.js";
import { VERSION } from "../../version.js";
import { RUNS_REPO } from "../runs/plugin.js";
import type { RunStatus } from "../runs/repo.js";
import { SETTINGS } from "../settings/plugin.js";
import { howToUpdate, installKind, isNewer, latestVersion, VERSION_RE, type InstallKind } from "./install.js";

// Updates: whether a newer Watchwright is on npm, and updating to it from the web page. The server
// can't replace its own files while it runs (on Windows they are locked), so `updates.start` starts
// `watchwright update --worker` on its own and stops; the worker waits for the server to exit,
// runs `npm install -g`, and starts the server again with the same options. In Docker, and other
// installs npm doesn't own, the page says how to update instead (docs: guide/updating).

/** How often a server that runs checks npm, after a first check shortly after it starts. */
const CHECK_EVERY_MS = 12 * 3600_000;
const FIRST_CHECK_MS = 15_000;
const GOING: RunStatus[] = ["queued", "running", "pausing", "paused"];

export interface LastUpdate {
  from: string;
  to: string;
  ok: boolean;
  message: string;
  at: string;
}

export interface UpdateStatus {
  version: string;
  /** The newest version on npm, null until a check got an answer. */
  latest: string | null;
  newer: boolean;
  checkedAt: string | null;
  /** Why the last check failed, null when it worked. */
  error: string | null;
  /** Whether the server checks npm by itself (the `updates.check` setting). */
  check: boolean;
  install: InstallKind;
  /** Whether Update in Settings works here: a global npm install, on a server the watchwright command started. */
  canUpdate: boolean;
  /** What to do, in words, when it can't update itself. */
  how: string;
  /** How the last update of this data folder went. */
  last: LastUpdate | null;
}

/** The result file the update worker writes, in the data folder's logs. */
export function lastUpdateFile(dataDir: string): string {
  return path.join(dataDir, "logs", "update.json");
}
export function updateLogFile(dataDir: string): string {
  return path.join(dataDir, "logs", "update.log");
}

function readLast(dataDir: string): LastUpdate | null {
  try {
    return JSON.parse(readFileSync(lastUpdateFile(dataDir), "utf8")) as LastUpdate;
  } catch {
    return null;
  }
}

/** The options this server process was started with (`serve`'s, or `demo`'s), to start it again the same way, and the address it answers at here. */
export function restartPlan(argv: readonly string[], env: NodeJS.ProcessEnv): { args: string[]; url: string } {
  const [command, ...rest] = argv;
  const args = command === "serve" || command === "demo" ? rest.filter((a) => a !== "--background") : [];
  const { values } = parseArgs({ args, strict: false, allowPositionals: true, options: { port: { type: "string" }, host: { type: "string" } } });
  const port = typeof values.port === "string" ? values.port : String(DEFAULT_PORT);
  const host = typeof values.host === "string" ? values.host : (env.WATCHWRIGHT_HOST ?? DEFAULT_HOST);
  const local = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host === "::1" ? "[::1]" : host;
  return { args, url: `http://${local}:${port}/` };
}

export const updatesPlugin = definePlugin({
  name: "updates",
  setup({ services }) {
    if (!services.has(UPDATE_CHECKER)) services.provide(UPDATE_CHECKER, new UpdateChecker());
    services.get(SETTINGS).define({ key: "updates.check", title: "Check npm for a newer Watchwright", schema: { type: "boolean" }, default: true });
  },
  ready(ctx) {
    // Only a server the watchwright command started checks by itself (not one built in a test).
    if (!ctx.stop) return;
    const state = ctx.services.get(UPDATE_CHECKER);
    const tick = () => {
      if (ctx.services.get(SETTINGS).get<boolean>("updates.check")) void state.check();
    };
    state.timers.push(setTimeout(tick, FIRST_CHECK_MS).unref(), setInterval(tick, CHECK_EVERY_MS).unref());
  },
  close({ services }) {
    for (const t of services.get(UPDATE_CHECKER).timers.splice(0)) clearTimeout(t);
  },
  actions: ({ services, store, stop }) => {
    const settings = services.get(SETTINGS);
    const state = services.get(UPDATE_CHECKER);
    let kind: InstallKind | null = null;
    const install = () => (kind ??= state.install());
    const status = (): UpdateStatus => {
      const k = install();
      const canUpdate = k === "npm" && stop !== null;
      return {
        version: VERSION,
        latest: state.latest,
        newer: state.latest !== null && isNewer(VERSION, state.latest),
        checkedAt: state.checkedAt,
        error: state.error,
        check: settings.get<boolean>("updates.check"),
        install: k,
        canUpdate,
        how: k === "npm" && !canUpdate ? "This server wasn't started by the watchwright command. Stop it, run `npm install -g watchwright@latest` and start it again." : howToUpdate(k),
        last: readLast(store.dataDir),
      };
    };
    return [
      defineAction<{ refresh?: boolean }>({
        name: "updates.status",
        title: "This server's version, the newest on npm, and how to update",
        method: "GET",
        path: "/updates",
        input: { type: "object", properties: { refresh: { type: "boolean", default: false, description: "Ask npm now instead of using the last answer." } } },
        handler: async ({ refresh = false }) => {
          if (refresh || (state.checkedAt === null && settings.get<boolean>("updates.check"))) await state.check();
          return status();
        },
      }),
      defineAction<{ version?: string; now?: boolean }>({
        name: "updates.start",
        access: "admin",
        destructive: true,
        explain: ({ version }) => `Update Watchwright from ${VERSION} to ${version ?? state.latest ?? "the newest version"}: it stops, installs the new version and starts again`,
        title: "Update this server to the newest version on npm: it stops, runs npm install -g and starts again with the same options",
        method: "POST",
        path: "/updates",
        input: {
          type: "object",
          properties: {
            version: { type: "string", pattern: VERSION_RE.source, description: "The version to install (default: the newest on npm)." },
            now: { type: "boolean", default: false, description: "Update even while runs go; they are interrupted and go on after the server starts again." },
          },
        },
        handler: async ({ version, now = false }) => {
          const s = status();
          if (!s.canUpdate) throw new ActionError("cant_update", s.how, 409);
          let to = version;
          if (!to) {
            await state.check();
            if (!state.latest) throw new ActionError("no_answer", state.error ?? "npm's registry didn't answer.", 502);
            to = state.latest;
          }
          if (to === VERSION) throw new ActionError("up_to_date", `Watchwright ${VERSION} is already the version asked for.`, 409);
          const going = services.get(RUNS_REPO).runs({ statuses: GOING });
          if (going.length > 0 && !now) {
            throw new ActionError("runs_going", `${going.length === 1 ? "A run is" : `${going.length} runs are`} going. Update when ${going.length === 1 ? "it ends" : "they end"}, or update now: ${going.length === 1 ? "it is" : "they are"} interrupted and go on after the server starts again.`, 409, {
              runs: going.map((r) => r.id),
            });
          }
          const plan = restartPlan(process.argv.slice(2), process.env);
          const main = process.argv[1];
          if (!main) throw new ActionError("cant_update", "This server doesn't know the script it runs from.", 409);
          const log = updateLogFile(store.dataDir);
          mkdirSync(path.dirname(log), { recursive: true });
          const fd = openSync(log, "w");
          const args = [main, "update", "--worker", "--pid", String(process.pid), "--from", VERSION, "--to", to, "--url", plan.url, "--data", store.dataDir, "--restart", JSON.stringify(plan.args)];
          // Its own process, outside the package's folder: it outlives this server and npm replaces that folder.
          const child = spawn(process.execPath, [...process.execArgv, ...args], { detached: true, stdio: ["ignore", fd, fd], windowsHide: true, cwd: homedir() });
          closeSync(fd);
          child.unref();
          // After the answer has gone out.
          setTimeout(stop!, 300);
          return { updating: true, from: VERSION, to, log };
        },
      }),
    ];
  },
});

/** The last answer from npm, for this server. */
export class UpdateChecker {
  latest: string | null = null;
  checkedAt: string | null = null;
  error: string | null = null;
  readonly timers: NodeJS.Timeout[] = [];
  private pending: Promise<void> | null = null;

  constructor(
    private readonly lookup: () => Promise<string> = () => latestVersion(),
    /** How this copy was installed; asked once, when first needed. */
    readonly install: () => InstallKind = () => installKind(),
  ) {}

  /** Asks npm (one question at a time). */
  check(): Promise<void> {
    this.pending ??= this.lookup()
      .then((v) => {
        this.latest = v;
        this.error = null;
      })
      .catch((err: unknown) => {
        this.error = err instanceof Error ? err.message : String(err);
      })
      .finally(() => {
        this.checkedAt = new Date().toISOString();
        this.pending = null;
      });
    return this.pending;
  }
}

/** The checker; a test may provide its own before the plugin's setup (a fake npm). */
export const UPDATE_CHECKER = serviceKey<UpdateChecker>("updates.checker");
