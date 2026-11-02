import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import type { McpServer } from "@modelcontextprotocol/server";
import type { ActionInfo } from "../actions/registry.js";
import { buildMcpServer, setTools, ToolError, type ToolDoor } from "../plugins/agents/tools.js";
import { VERSION } from "../version.js";
import { ApiError, Client, NoServer, serverUrl, tokenHeader, type Health } from "./client.js";
import { currentUpdate } from "./update-lock.js";

// `watchwright mcp`: the MCP server over stdio, for clients that start a process instead of
// connecting to an address. It is a bridge: its tools come from the running server's actions and
// its calls go there over HTTP, so it behaves as /api/v1/mcp does. Nothing but MCP goes to stdout.

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** Starts `watchwright serve --no-open` on the address's port, detached so it outlives the bridge. */
function startServer(url: URL): void {
  // The same entry this process runs, with the same Node options.
  const main = process.argv[1] ?? fileURLToPath(new URL("./main.js", import.meta.url));
  const port = url.port || "80";
  const child = spawn(process.execPath, [...process.execArgv, main, "serve", "--no-open", "--port", port], { detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
}

/** The server's health, waiting up to `ms` for it to come up. */
async function waitForServer(client: Client, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await client.health(1000)) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

/** Whether the answer is an approval to wait on rather than the action's result (a 202). */
function isApproval(data: unknown): boolean {
  const a = data && typeof data === "object" ? (data as { approval?: { status?: unknown } }).approval : undefined;
  return a?.status === "waiting";
}

/** Serves MCP on stdio; resolves when stdin closes (the MCP client went away). */
export async function mcpCommand(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: { server: { type: "string" }, as: { type: "string" }, "no-start": { type: "boolean" } },
  });
  const base = serverUrl(values.server);
  const given = (values.as ?? process.env.WATCHWRIGHT_CLIENT)?.trim();
  const probe = new Client(base, given || "mcp");
  const url = new URL(base);
  const mayStart = !values["no-start"] && LOOPBACK.has(url.hostname);
  if (!(await probe.health())) {
    if (!mayStart) {
      process.stderr.write(`No Watchwright answers at ${base}. Start it with \`watchwright serve\`.\n`);
      return 3;
    }
    process.stderr.write(`Starting Watchwright at ${base}…\n`);
    startServer(url);
    if (!(await waitForServer(probe, 20_000))) {
      process.stderr.write(`Watchwright didn't come up at ${base}. Run \`watchwright serve\` to see why.\n`);
      return 3;
    }
  }
  const bridge = new Bridge(base, mayStart, {
    health: (ms) => new Client(base, "mcp").health(ms),
    actions: () => new Client(base, "mcp").listActions(),
    start: () => startServer(url),
    updating: () => currentUpdate() !== null,
  });
  await bridge.load();
  process.stderr.write(`Watchwright MCP over stdio, calling ${base}\n`);

  const door: ToolDoor = {
    call: (info, input, client, signal) => bridge.call(() => new Client(base, client).call(info, input, signal)),
  };
  // Tell the server who called which tool, for Settings > Agents; a miss doesn't matter.
  const onCall = (client: string, tool: string) =>
    void fetch(new URL("api/v1/agents/seen", base), { method: "POST", headers: { "content-type": "application/json", ...tokenHeader(base) }, body: JSON.stringify({ client, tool }), signal: AbortSignal.timeout(2000) }).catch(() => undefined);
  const handle = serveStdio(
    () => bridge.track(buildMcpServer({ version: VERSION, actions: bridge.actions, door, caller: (info) => (given ? given.slice(0, 60) : (info ?? "mcp")), onCall, page: new URL("/", base).href })),
    { onerror: (err) => process.stderr.write(`${err.message}\n`) },
  );
  await new Promise<void>((resolve) => {
    process.stdin.once("end", resolve);
    process.stdin.once("close", resolve);
  });
  await handle.close();
  return 0;
}

export interface BridgeDeps {
  health: (ms: number) => Promise<Health | null>;
  actions: () => Promise<ActionInfo[]>;
  /** Starts a server in the background. */
  start: () => void;
  /** Whether `watchwright update` is replacing the package now (it starts the server again itself). */
  updating: () => boolean;
}

/**
 * What keeps the bridge working while the server comes and goes: a call that finds no server waits
 * for one (an update brings it back; otherwise the bridge starts it, as at the start), and once the
 * server answers as another version, the tools follow its actions. So an update never needs the
 * MCP client (Claude Desktop) to restart.
 */
export class Bridge {
  actions: ActionInfo[] = [];
  private version = "";
  private checkedAt = 0;
  private readonly servers = new Set<McpServer>();
  private back: Promise<Health | null> | null = null;

  constructor(
    private readonly base: string,
    private readonly mayStart: boolean,
    private readonly deps: BridgeDeps,
    /** How long to wait for the server: through an update, after starting it. */
    private readonly waits = { update: 5 * 60_000, start: 20_000, poll: 300 },
  ) {}

  /** The server's version and actions now. */
  async load(): Promise<void> {
    const h = await this.deps.health(2000);
    this.actions = await this.deps.actions();
    this.version = h?.version ?? "";
    this.checkedAt = Date.now();
  }

  track(server: McpServer): McpServer {
    this.servers.add(server);
    return server;
  }

  /** Runs a call; when no server answers, waits for one (or starts it) and tries once more. */
  async call(fn: () => Promise<unknown>): Promise<{ status: number; data: unknown }> {
    let data: unknown;
    try {
      data = await this.guard(fn);
    } catch (err) {
      if (!(err instanceof NoServer)) throw err;
      const h = await this.ensureServer();
      if (!h) throw new ToolError("no_server", this.deps.updating() ? `Watchwright at ${this.base} is updating and isn't back yet. Try again in a minute.` : err.message);
      await this.follow(h, true);
      data = await this.guard(fn).catch((e: unknown) => {
        if (e instanceof NoServer) throw new ToolError("no_server", e.message);
        throw e;
      });
    }
    // Now and then, see whether the server changed version behind our back (updated from its page).
    if (Date.now() - this.checkedAt > 60_000) {
      this.checkedAt = Date.now();
      void this.deps.health(2000).then((h) => (h ? this.follow(h) : undefined)).catch(() => undefined);
    }
    return { status: isApproval(data) ? 202 : 200, data };
  }

  private async guard(fn: () => Promise<unknown>): Promise<unknown> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof ApiError) throw new ToolError(err.code, err.message, err.detail);
      throw err;
    }
  }

  /** A server that answers: the one up, the one an update brings back, or one the bridge starts. One wait for every call. */
  ensureServer(): Promise<Health | null> {
    this.back ??= this.waitBack().finally(() => (this.back = null));
    return this.back;
  }

  private async waitBack(): Promise<Health | null> {
    const up = await this.deps.health(1000);
    if (up) return up;
    const until = async (ms: number, stopWhen: () => boolean = () => false) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        const h = await this.deps.health(1000);
        if (h) return h;
        if (stopWhen()) return null;
        await new Promise((r) => setTimeout(r, this.waits.poll));
      }
      return null;
    };
    if (this.deps.updating()) {
      const h = await until(this.waits.update, () => !this.deps.updating());
      if (h) return h;
      // The update ended without a server (it was stopped before): start one as usual.
    }
    if (!this.mayStart) return null;
    process.stderr.write(`Starting Watchwright at ${this.base}…\n`);
    this.deps.start();
    return until(this.waits.start);
  }

  /** The server answers as another version (or came back, `again`): take its actions and give every connection the new tools. */
  private async follow(h: Health, again = false): Promise<void> {
    this.checkedAt = Date.now();
    if (h.version === this.version && !again) return;
    const actions = await this.deps.actions();
    this.version = h.version;
    if (JSON.stringify(actions) === JSON.stringify(this.actions)) return;
    this.actions = actions;
    for (const s of this.servers) setTools(s, actions);
    process.stderr.write(`Watchwright ${h.version}: the tools follow its actions.\n`);
  }
}
