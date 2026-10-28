import { randomUUID } from "node:crypto";
import { createMcpHandler, isInitializeRequest, isLegacyRequest, type McpHttpHandler } from "@modelcontextprotocol/server";
import { NodeStreamableHTTPServerTransport, toNodeHandler, toWebRequest, type NodeIncomingMessageLike } from "@modelcontextprotocol/node";
import type { FastifyReply } from "fastify";
import { ActionError, defineAction, describeAction, invokeAction, type Action } from "../../actions/registry.js";
import { ACTION_GATE, ACTIONS } from "../../core/keys.js";
import { definePlugin, type PluginContext } from "../../core/plugin.js";
import { DEFAULT_PORT } from "../../config.js";
import { VERSION } from "../../version.js";
import { AGENTS, installAgents, mcpUrl, type AgentKind } from "./install.js";
import { Seen } from "./seen.js";
import { agentName, buildMcpServer, ToolError, type ToolDoor } from "./tools.js";

// Agents: the MCP server at /api/v1/mcp, with a tool for each action an agent should use
// (docs/plans/step-5.md, section 4). Calls run the actions in the server, through the same
// approvals gate as HTTP requests, so a destructive tool waits for the person. Also: who called
// lately, and installing the skill and the MCP settings into a project (section 5).

/** The caller's name: the `x-watchwright-client` header, else the MCP client's name, else a known user agent. */
function callerOf(req: Request | undefined, clientInfo: string | null): string {
  const given = req?.headers.get("x-watchwright-client")?.trim();
  if (given) return given.slice(0, 60);
  if (clientInfo) return clientInfo;
  // User agents look like `claude-code/2.1.0 (…)`; only known agents count, not `node` or `undici`.
  const agent = req?.headers.get("user-agent")?.split("/")[0];
  const known = agentName(agent);
  return known && known !== agent ? known : "mcp";
}

/** A 2025-era MCP connection: its transport and server, kept between requests by session id. */
interface Session {
  transport: NodeStreamableHTTPServerTransport;
  seen: number;
}

/** Sessions nobody used for this long are closed. */
const SESSION_IDLE_MS = 60 * 60_000;

const doors = new WeakMap<PluginContext, { modern: McpHttpHandler; sessions: Map<string, Session>; sweep: NodeJS.Timeout }>();

function rpcError(reply: FastifyReply, status: number, message: string) {
  return reply.code(status).send({ jsonrpc: "2.0", id: null, error: { code: -32000, message } });
}

const seenOf = new WeakMap<PluginContext["store"], Seen>();
const seen = (store: PluginContext["store"]): Seen => {
  let s = seenOf.get(store);
  if (!s) seenOf.set(store, (s = new Seen(store.db)));
  return s;
};

const DEFAULT_SERVER = `http://127.0.0.1:${DEFAULT_PORT}/`;

export const agentsPlugin = definePlugin({
  name: "agents",
  migrations: [{ id: 1, name: "seen", sql: Seen.SQL }],
  actions: ({ store }) => [
    defineAction<{ days?: number }>({
      name: "agents.seen",
      title: "Agents that called the MCP server lately: when, their last tool, how many calls and how many runs and explore sessions they started",
      method: "GET",
      path: "/agents/seen",
      input: { type: "object", properties: { days: { type: "integer", minimum: 1, maximum: 365, default: 30 } } },
      handler: ({ days = 30 }) => seen(store).list(days),
    }),
    defineAction<{ folder: string; agents?: AgentKind[]; mcp?: boolean; server?: string }>({
      name: "agents.install",
      title: "Put the Watchwright skill into a project for Claude Code, Codex or Cursor, and the MCP server into its settings (merged, never trimmed)",
      method: "POST",
      path: "/agents/install",
      input: {
        type: "object",
        properties: {
          folder: { type: "string", minLength: 1, description: "The project's folder." },
          agents: { type: "array", items: { type: "string", enum: [...AGENTS] }, description: "Which agents; none: those whose folders the project has, else all." },
          mcp: { type: "boolean", default: true, description: "Also add the MCP server to the project's settings." },
          server: { type: "string", description: `The server's address as the agents reach it (default ${DEFAULT_SERVER}).` },
        },
        required: ["folder"],
      },
      handler: ({ folder, agents, mcp = true, server }) => {
        try {
          return installAgents({ folder, ...(agents ? { agents } : {}), mcp, url: mcpUrl(server ?? DEFAULT_SERVER) });
        } catch (err) {
          throw new ActionError("install_failed", err instanceof Error ? err.message : String(err), 400);
        }
      },
    }),
  ],
  routes(app, ctx) {
    const { services } = ctx;
    const actions = (): readonly Action[] => services.get(ACTIONS);
    const door: ToolDoor = {
      async call(info, input, client, signal) {
        const action = actions().find((a) => a.name === info.name);
        if (!action) throw new ToolError("unknown_action", `There is no action ${info.name}.`);
        const gate = services.has(ACTION_GATE) ? services.get(ACTION_GATE) : null;
        try {
          return await invokeAction(action, input, { client, signal, fromPage: false }, gate);
        } catch (err) {
          if (err instanceof ActionError) throw new ToolError(err.code, err.message, err.detail);
          throw err;
        }
      },
    };
    const note = (client: string, tool: string) => seen(ctx.store).note(client, tool);
    const build = (req: Request | undefined) => buildMcpServer({ version: VERSION, actions: actions().map(describeAction), door, caller: (info) => callerOf(req, info), onCall: note, ...(req ? { page: new URL("/", req.url).href } : {}) });

    // `watchwright mcp` (the stdio bridge) calls actions over HTTP and says here which tool it ran.
    app.post<{ Body: { client?: unknown; tool?: unknown } }>("/agents/seen", (req, reply) => {
      const { client, tool } = req.body ?? {};
      if (typeof client !== "string" || typeof tool !== "string" || !client.trim() || !/^[a-z_]{1,60}$/.test(tool)) return reply.code(400).send({ error: { code: "bad_input", message: "Send { client, tool }." } });
      note(client.trim().slice(0, 60), tool);
      return { data: { ok: true } };
    });

    // Two protocol eras: 2026 clients send each request on its own (the SDK's handler serves them);
    // 2025 clients open a session, which keeps the server that saw their name at initialize.
    const modern = createMcpHandler(({ requestInfo }) => build(requestInfo), { legacy: "reject" });
    const node = toNodeHandler(modern);
    const sessions = new Map<string, Session>();
    const sweep = setInterval(() => {
      for (const [id, s] of sessions) if (Date.now() - s.seen > SESSION_IDLE_MS) void s.transport.close().finally(() => sessions.delete(id));
    }, 60_000);
    sweep.unref();
    doors.set(ctx, { modern, sessions, sweep });

    app.route({
      method: ["GET", "POST", "DELETE"],
      url: "/mcp",
      handler: async (req, reply) => {
        // An IncomingMessage is one; only exactOptionalPropertyTypes tells them apart.
        const raw = req.raw as NodeIncomingMessageLike;
        const sid = req.headers["mcp-session-id"];
        if (typeof sid === "string") {
          const s = sessions.get(sid);
          if (!s) return rpcError(reply, 404, "No such MCP session; initialize again.");
          s.seen = Date.now();
          reply.hijack();
          return s.transport.handleRequest(req.raw, reply.raw, req.body);
        }
        const web = await toWebRequest(raw, req.body);
        if (!(await isLegacyRequest(web, req.body))) {
          reply.hijack();
          return node(raw, reply.raw, req.body);
        }
        if (req.method !== "POST" || !isInitializeRequest(req.body)) return rpcError(reply, 400, "Start with an initialize request.");
        const transport: NodeStreamableHTTPServerTransport = new NodeStreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            sessions.set(id, { transport, seen: Date.now() });
          },
          onsessionclosed: (id) => {
            sessions.delete(id);
          },
        });
        await build(web).connect(transport);
        reply.hijack();
        return transport.handleRequest(req.raw, reply.raw, req.body);
      },
    });
  },
  async close(ctx) {
    const d = doors.get(ctx);
    if (!d) return;
    clearInterval(d.sweep);
    await Promise.all([...d.sessions.values()].map((s) => s.transport.close()));
    await d.modern.close();
    doors.delete(ctx);
  },
});
