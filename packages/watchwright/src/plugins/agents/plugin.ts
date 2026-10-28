import { randomUUID } from "node:crypto";
import { createMcpHandler, isInitializeRequest, isLegacyRequest, type McpHttpHandler } from "@modelcontextprotocol/server";
import { NodeStreamableHTTPServerTransport, toNodeHandler, toWebRequest, type NodeIncomingMessageLike } from "@modelcontextprotocol/node";
import type { FastifyReply } from "fastify";
import { ActionError, describeAction, invokeAction, type Action } from "../../actions/registry.js";
import { ACTION_GATE, ACTIONS } from "../../core/keys.js";
import { definePlugin, type PluginContext } from "../../core/plugin.js";
import { VERSION } from "../../version.js";
import { agentName, buildMcpServer, ToolError, type ToolDoor } from "./tools.js";

// Agents: the MCP server at /api/v1/mcp, with a tool for each action an agent should use
// (docs/plans/step-5.md, section 4). Calls run the actions in the server, through the same
// approvals gate as HTTP requests, so a destructive tool waits for the person.

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

export const agentsPlugin = definePlugin({
  name: "agents",
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
    const build = (req: Request | undefined) => buildMcpServer({ version: VERSION, actions: actions().map(describeAction), door, caller: (info) => callerOf(req, info) });

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
