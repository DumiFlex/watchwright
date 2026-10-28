import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { buildMcpServer, ToolError, type ToolDoor } from "../plugins/agents/tools.js";
import { VERSION } from "../version.js";
import { ApiError, Client, NoServer, serverUrl } from "./client.js";

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
  if (!(await probe.health())) {
    const url = new URL(base);
    if (values["no-start"] || !LOOPBACK.has(url.hostname)) {
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
  const actions = await probe.listActions();
  process.stderr.write(`Watchwright MCP over stdio, calling ${base}\n`);

  const door: ToolDoor = {
    async call(info, input, client, signal) {
      try {
        const data = await new Client(base, client).call(info, input, signal);
        return { status: isApproval(data) ? 202 : 200, data };
      } catch (err) {
        if (err instanceof ApiError) throw new ToolError(err.code, err.message, err.detail);
        if (err instanceof NoServer) throw new ToolError("no_server", err.message);
        throw err;
      }
    },
  };
  // Tell the server who called which tool, for Settings > Agents; a miss doesn't matter.
  const onCall = (client: string, tool: string) =>
    void fetch(new URL("api/v1/agents/seen", base), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client, tool }), signal: AbortSignal.timeout(2000) }).catch(() => undefined);
  const handle = serveStdio(() => buildMcpServer({ version: VERSION, actions, door, caller: (info) => (given ? given.slice(0, 60) : (info ?? "mcp")), onCall }), {
    onerror: (err) => process.stderr.write(`${err.message}\n`),
  });
  await new Promise<void>((resolve) => {
    process.stdin.once("end", resolve);
    process.stdin.once("close", resolve);
  });
  await handle.close();
  return 0;
}
