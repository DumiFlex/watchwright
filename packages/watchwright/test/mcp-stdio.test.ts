import { fileURLToPath } from "node:url";
import { Client, type CallToolResult } from "@modelcontextprotocol/client";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { afterEach, describe, expect, it } from "vitest";
import { defineAction } from "../src/actions/registry.js";
import { removeLock, writeLock } from "../src/cli/update-lock.js";
import { definePlugin } from "../src/core/plugin.js";
import { APPROVALS } from "../src/plugins/approvals/plugin.js";
import { cleanTempDirs, tempDir } from "./helpers/fixtures.js";
import { freePort, startHarness, type Harness } from "./helpers/harness.js";

// `watchwright mcp`: the stdio bridge, as an MCP client starts it.

const MAIN = fileURLToPath(new URL("../src/cli/main.ts", import.meta.url));
// tsx is found from the package folder, whichever folder the tests run from.
const PACKAGE = fileURLToPath(new URL("..", import.meta.url));
const harnesses: Harness[] = [];
const clients: Client[] = [];
const started: string[] = [];
afterEach(async () => {
  for (const c of clients.splice(0)) await c.close();
  for (const h of harnesses.splice(0)) await h.close();
  // Servers the bridge started stop as the web page would stop them.
  for (const host of started.splice(0)) {
    await fetch(`http://${host}/api/v1/stop`, { method: "POST", headers: { origin: `http://${host}` } }).catch(() => undefined);
    // It answers before it closes; its database stays open (and locked on Windows) until it is gone.
    for (let i = 0; i < 100; i++) {
      if (!(await fetch(`http://${host}/api/v1/health`).then(() => true, () => false))) break;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  cleanTempDirs();
});

async function connect(args: string[], env: Record<string, string> = {}) {
  const client = new Client({ name: "claude-code", version: "1.0.0" });
  const transport = new StdioClientTransport({ command: process.execPath, args: ["--import", "tsx", MAIN, "mcp", ...args], env: { ...getDefaultEnvironment(), ...env }, cwd: PACKAGE, stderr: "pipe" });
  const said: string[] = [];
  transport.stderr?.on("data", (b: Buffer) => said.push(b.toString()));
  await client.connect(transport).catch((err: unknown) => {
    throw new Error(`${String(err)}; it said: ${said.join("")}`);
  });
  clients.push(client);
  return client;
}

describe("watchwright mcp", { timeout: 60_000 }, () => {
  it("offers the server's tools and calls them over HTTP, as the client that asked", async () => {
    const h = await startHarness(tempDir("ww-data-"), { listen: true });
    harnesses.push(h);
    h.app.watchwright.services.get(APPROVALS).holdMs = 50;
    const client = await connect(["--server", String(h.port)]);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(["list_packs", "start_run", "delete_run", "call_action"]));

    const packs = (await client.callTool({ name: "list_packs", arguments: {} })) as CallToolResult;
    expect(packs.content[0]).toEqual({ type: "text", text: "[]" });
    const missing = (await client.callTool({ name: "get_run", arguments: { id: "0000abcd" } })) as CallToolResult;
    expect(missing.isError).toBe(true);

    // A destructive tool waits for the person, under the agent's name.
    const del = (await client.callTool({ name: "delete_run", arguments: { id: "0000abcd" } })) as CallToolResult;
    expect(del.content[0]?.type === "text" ? del.content[0].text : "").toContain("Waiting for the person to approve");
    expect(h.app.watchwright.services.get(APPROVALS).list("waiting")[0]).toMatchObject({ client: "Claude Code", action: "runs.delete" });
  });

  it("starts a server in the background when none answers", async () => {
    const port = await freePort();
    started.push(`127.0.0.1:${port}`);
    const client = await connect(["--server", String(port)], { WATCHWRIGHT_DATA: tempDir("ww-data-") });
    const packs = (await client.callTool({ name: "list_packs", arguments: {} })) as CallToolResult;
    expect(packs.isError).toBeFalsy();
    const health = (await (await fetch(`http://127.0.0.1:${port}/api/v1/health`)).json()) as { data: { name: string } };
    expect(health.data.name).toBe("watchwright");
  });

  it("keeps working through an update: waits for the server instead of starting the old one, then offers its new tools", async () => {
    const config = tempDir("ww-config-");
    const data = tempDir("ww-data-");
    const first = await startHarness(data, { listen: true });
    harnesses.push(first);
    const client = await connect(["--server", String(first.port), "--no-start"], { WATCHWRIGHT_CONFIG_DIR: config });
    let changed = false;
    client.setNotificationHandler("notifications/tools/list_changed", () => {
      changed = true;
    });
    expect((await client.listTools()).tools.map((t) => t.name)).not.toContain("say_hello");

    // An update is going on: the server is gone, and the new version has a tool more.
    writeLock({ pid: process.pid, from: "1.0.0", to: "1.1.0", startedAt: new Date().toISOString() }, { WATCHWRIGHT_CONFIG_DIR: config });
    await first.close();
    const call = client.callTool({ name: "list_packs", arguments: {} }) as Promise<CallToolResult>;
    await new Promise((r) => setTimeout(r, 1500));
    const hello = definePlugin({
      name: "hello",
      actions: () => [defineAction({ name: "hello.say", agent: { tool: "say_hello", say: "Says hello." }, title: "Say hello", method: "GET", path: "/hello", handler: () => ({ hello: true }) })],
    });
    const second = await startHarness(data, { listen: true, port: first.port, plugins: [hello] });
    harnesses.push(second);
    removeLock({ WATCHWRIGHT_CONFIG_DIR: config });

    expect((await call).isError).toBeFalsy();
    expect((await client.listTools()).tools.map((t) => t.name)).toContain("say_hello");
    expect(changed).toBe(true);
    const said = (await client.callTool({ name: "say_hello", arguments: {} })) as CallToolResult;
    expect(said.content[0]).toEqual({ type: "text", text: '{"hello":true}' });
  });

  it("says so and stops when no server answers and starting one is off", async () => {
    const port = await freePort();
    await expect(connect(["--server", String(port), "--no-start"])).rejects.toThrow();
  });
});
