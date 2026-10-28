import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client, StreamableHTTPClientTransport, type CallToolResult } from "@modelcontextprotocol/client";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { defineAction, describeAction } from "../src/actions/registry.js";
import { BUILTIN_PLUGINS } from "../src/core/builtin.js";
import { ACTIONS } from "../src/core/keys.js";
import { definePlugin, migrationsOf } from "../src/core/plugin.js";
import { APPROVALS, type Approval } from "../src/plugins/approvals/plugin.js";
import { agentName, packIdOf, toolsOf, ToolError } from "../src/plugins/agents/tools.js";
import { buildServer } from "../src/server/app.js";
import { openStore, type Store } from "../src/store/db.js";
import { freePort } from "./helpers/harness.js";

// The MCP server at /api/v1/mcp, through the SDK's own client over real HTTP.

const open: { app: FastifyInstance; store: Store; client?: Client; dir: string }[] = [];
afterEach(async () => {
  for (const o of open.splice(0)) {
    await o.client?.close();
    await o.app.close();
    o.store.close();
    rmSync(o.dir, { recursive: true, force: true });
  }
});

const dropped: string[] = [];
const demo = definePlugin({
  name: "demo",
  actions: () => [
    defineAction<{ n: number; by?: number }>({
      name: "demo.double",
      title: "Double a number",
      agent: { tool: "double", say: "For tests." },
      method: "GET",
      path: "/double",
      output: { type: "object", properties: { value: { type: "number" }, by: { type: "string" } }, required: ["value", "by"] },
      input: { type: "object", properties: { n: { type: "number" }, by: { type: "number", default: 2 } }, required: ["n"] },
      handler: ({ n, by = 0 }, { client }) => ({ value: n * by, by: client }),
    }),
    defineAction<{ id: string }>({
      name: "demo.drop",
      title: "Drop a thing",
      agent: { tool: "drop" },
      method: "DELETE",
      path: "/things/:id",
      destructive: true,
      explain: ({ id }) => `Drop the thing ${id}`,
      input: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      handler: ({ id }, { client }) => {
        dropped.push(`${id} as ${client}`);
        return { dropped: id };
      },
    }),
    defineAction({
      name: "demo.hidden",
      title: "Not a tool",
      method: "GET",
      path: "/hidden",
      handler: () => ({ hidden: true }),
    }),
  ],
});

async function start(opts: { mode?: "legacy" | "auto"; name?: string; headers?: Record<string, string> } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "ww-mcp-"));
  const plugins = [...BUILTIN_PLUGINS, demo];
  const store = openStore(dir, migrationsOf(plugins));
  const port = await freePort();
  const app = await buildServer({ store, port, plugins });
  const o: (typeof open)[number] = { app, store, dir };
  open.push(o);
  await app.listen({ port, host: "127.0.0.1" });
  const client = new Client({ name: opts.name ?? "claude-code", version: "1.0.0" }, { versionNegotiation: { mode: opts.mode ?? "legacy" } });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/api/v1/mcp`), opts.headers ? { requestInit: { headers: opts.headers } } : {}));
  o.client = client;
  return { app, client, port };
}

const text = (r: CallToolResult, i = 0) => {
  const c = r.content[i];
  return c?.type === "text" ? c.text : "";
};

describe("MCP server", () => {
  for (const mode of ["legacy", "auto"] as const) {
    it(`lists the tools and calls them (${mode} protocol)`, async () => {
      const { client } = await start({ mode });
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name);
      expect(names).toEqual(expect.arrayContaining(["list_packs", "start_run", "wait_for_run", "get_file", "delete_run", "delete_pack_file", "wait_for_approval", "list_actions", "call_action", "double", "drop"]));
      expect(names).not.toContain("hidden");
      const double = tools.find((t) => t.name === "double")!;
      expect(double.description).toBe("Double a number. For tests.");
      expect(double.annotations).toMatchObject({ readOnlyHint: true });
      expect(tools.find((t) => t.name === "drop")!.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });

      // Defaults are filled as the HTTP route fills them, and the agent is named by its client name.
      const r = (await client.callTool({ name: "double", arguments: { n: 4 } })) as CallToolResult;
      expect(r.isError).toBeFalsy();
      expect(r.structuredContent).toEqual({ value: 8, by: "Claude Code" });
      expect(JSON.parse(text(r))).toEqual({ value: 8, by: "Claude Code" });

      // Bad input and errors come back for the agent to read.
      const bad = (await client.callTool({ name: "double", arguments: { n: "four" } })) as CallToolResult;
      expect(bad.isError).toBe(true);
      const missing = (await client.callTool({ name: "get_run", arguments: { id: "0000abcd" } })) as CallToolResult;
      expect(missing.isError).toBe(true);
      expect(text(missing)).toMatch(/^not_found: /);

      // call_action reaches actions without a tool.
      const hidden = (await client.callTool({ name: "call_action", arguments: { name: "demo.hidden" } })) as CallToolResult;
      expect(JSON.parse(text(hidden))).toEqual({ hidden: true });
      const none = (await client.callTool({ name: "call_action", arguments: { name: "demo.nope" } })) as CallToolResult;
      expect(none.isError).toBe(true);
    });
  }

  it("names the caller from the header when the client doesn't say", async () => {
    const { client } = await start({ mode: "auto", name: "", headers: { "x-watchwright-client": "Night script" } });
    const r = (await client.callTool({ name: "double", arguments: { n: 1 } })) as CallToolResult;
    expect(r.structuredContent).toMatchObject({ by: "Night script" });
  });

  it("asks the person before a destructive tool runs, through call_action too", async () => {
    const { app, client } = await start();
    app.watchwright.services.get(APPROVALS).holdMs = 30;
    dropped.length = 0;
    const r = (await client.callTool({ name: "drop", arguments: { id: "x" } })) as CallToolResult;
    expect(r.isError).toBeFalsy();
    expect(text(r)).toContain("Waiting for the person to approve on the web page: Drop the thing x");
    expect(dropped).toEqual([]);
    const [a] = app.watchwright.services.get(APPROVALS).list("waiting");
    expect(a).toMatchObject({ client: "Claude Code", action: "demo.drop" });
    await app.watchwright.services.get(APPROVALS).answer(a!.id, true, "web");
    const waited = (await client.callTool({ name: "wait_for_approval", arguments: { id: a!.id, timeout: 1 } })) as CallToolResult;
    expect((JSON.parse(text(waited)) as Approval).status).toBe("approved");
    expect(dropped).toEqual(["x as Claude Code"]);

    const viaCall = (await client.callTool({ name: "call_action", arguments: { name: "demo.drop", input: { id: "y" } } })) as CallToolResult;
    expect(text(viaCall)).toContain("Drop the thing y");
    expect(dropped).toEqual(["x as Claude Code"]);
  });

  it("refuses requests from other origins, like every route", async () => {
    const { port } = await start();
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", origin: "http://evil.example" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(403);
  });
});

describe("MCP tools from actions", () => {
  it("makes a tool of each action an agent should use, and every built-in one is described", async () => {
    const plugins = BUILTIN_PLUGINS;
    const store = openStore(":memory:", migrationsOf(plugins));
    const app = await buildServer({ store, port: 7420, plugins });
    try {
      const tools = toolsOf(app.watchwright.services.get(ACTIONS).map(describeAction));
      expect(tools.map((t) => t.name).sort()).toEqual(
        [
          "add_pack", "call_action", "check_test", "control_run", "create_pack", "delete_pack_file", "delete_run", "get_attempt", "get_file", "get_pack", "get_rubric", "get_run",
          "list_actions", "list_pack_files", "list_packs", "list_runs", "read_pack_file", "save_review", "start_run", "test_format", "wait_for_approval", "wait_for_run", "write_pack_file",
        ].sort(),
      );
      for (const t of tools) expect(t.description.length).toBeGreaterThan(10);
      expect(tools.find((t) => t.name === "delete_run")!.description).toMatch(/approves this on the web page/);
      // The docs site's tool table lists exactly these.
      const page = readFileSync(new URL("../../site/reference/mcp.md", import.meta.url), "utf8");
      const listed = [...page.matchAll(/^\| `([a-z_]+)` \|/gm)].map((m) => m[1]);
      expect(listed.sort()).toEqual(tools.map((t) => t.name).sort());
    } finally {
      await app.close();
      store.close();
    }
  });

  it("names agents as people know them", () => {
    expect(agentName("claude-code")).toBe("Claude Code");
    expect(agentName("codex-mcp-client")).toBe("Codex");
    expect(agentName("Cursor")).toBe("Cursor");
    expect(agentName("my-bot")).toBe("my-bot");
    expect(agentName(" ")).toBeNull();
  });

  it("finds a pack by id, name or folder", () => {
    const packs = [
      { id: "0000000a", name: "Checkout", path: "/x/checkout/watchwright.pack.ts", dir: "/x/checkout" },
      { id: "0000000b", name: "Login", path: "/x/login/watchwright.pack.ts", dir: "/x/login" },
    ];
    expect(packIdOf(packs, "0000000b")).toBe("0000000b");
    expect(packIdOf(packs, "checkout")).toBe("0000000a");
    expect(packIdOf(packs, "/x/login/")).toBe("0000000b");
    expect(() => packIdOf(packs, "nope")).toThrow(ToolError);
  });
});
