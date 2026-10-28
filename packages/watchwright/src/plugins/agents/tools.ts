import { CLIENT_INFO_META_KEY, fromJsonSchema, McpServer, type CallToolResult, type JsonSchemaType, type ServerContext, type ToolAnnotations } from "@modelcontextprotocol/server";
import type { ActionInfo, JsonSchema, ObjectSchema } from "../../actions/registry.js";

// The MCP tools, made from the actions: every action with `agent.tool` is a tool, plus
// `call_action` for the rest. Both doors (HTTP on the server, the stdio bridge in the CLI) build
// their server here and differ only in how a call reaches the action (docs/plans/step-5.md, section 4).

/** How a door runs an action: in the server, or over HTTP. Throws a `ToolError` for an error answer. */
export interface ToolDoor {
  call(action: ActionInfo, input: Record<string, unknown>, client: string, signal: AbortSignal): Promise<{ status: number; data: unknown }>;
}

/** An action's error answer, as the agent should read it. */
export class ToolError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
  }
}

export interface ToolSpec {
  name: string;
  description: string;
  input: ObjectSchema;
  output?: ObjectSchema;
  annotations: ToolAnnotations;
  /** The action it calls; null for `call_action`. */
  action: ActionInfo | null;
}

const CALL_ACTION: ObjectSchema = {
  type: "object",
  properties: {
    name: { type: "string", description: "The action's name, as list_actions gives it (`runs.presets.list`)." },
    input: { type: "object", description: "The action's input, as its `input` schema says. Path parameters go here too." },
  },
  required: ["name"],
  additionalProperties: false,
};

/** The tools for these actions, in their order, then `call_action`. */
export function toolsOf(actions: readonly ActionInfo[]): ToolSpec[] {
  const tools: ToolSpec[] = actions
    .filter((a) => a.agent)
    .map((a) => ({
      name: a.agent!.tool,
      description: [a.title.endsWith(".") ? a.title : `${a.title}.`, a.agent!.say, a.destructive ? "The person approves this on the web page before it runs; it may answer with an approval to wait on (wait_for_approval)." : undefined]
        .filter(Boolean)
        .join(" "),
      input: packNamesAllowed(a),
      ...(a.output?.type === "object" && a.output.properties ? { output: a.output as ObjectSchema } : {}),
      annotations: {
        title: a.title,
        readOnlyHint: a.method === "GET",
        ...(a.method === "GET" ? {} : { destructiveHint: a.destructive === true }),
        openWorldHint: false,
      },
      action: a,
    }));
  tools.push({
    name: "call_action",
    description:
      "Calls any action of the server by name, for what no other tool covers (list_actions lists them with their input). Actions that delete data or stop the server wait for the person's approval on the web page.",
    input: CALL_ACTION,
    annotations: { title: "Call an action", readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    action: null,
  });
  return tools;
}

/** Fills top-level defaults the HTTP route would fill, so the handler sees the same input. */
export function withDefaults(schema: ObjectSchema, input: Record<string, unknown>): Record<string, unknown> {
  const out = { ...input };
  for (const [k, p] of Object.entries(schema.properties)) if (out[k] === undefined && p.default !== undefined) out[k] = p.default;
  return out;
}

const PACK_ID = /^[0-9a-f]{8}$/;

/** Whether this input field names a pack, so a name or folder can stand for the id. */
function packField(a: ActionInfo): string | null {
  if (a.input.properties.packId) return "packId";
  if (/^\/api\/v1\/packs\/:id(\/|$)/.test(a.path)) return "id";
  return null;
}

/** The action's input, where a pack can also be named by its name or folder (the tool resolves it). */
function packNamesAllowed(a: ActionInfo): ObjectSchema {
  const field = packField(a);
  const prop = field ? a.input.properties[field] : undefined;
  if (!field || !prop) return a.input;
  const loose: JsonSchema = { ...prop, description: "The pack: its id, its name or its folder." };
  delete loose.pattern;
  return { ...a.input, properties: { ...a.input.properties, [field]: loose } };
}

interface PackInfo {
  id: string;
  name: string;
  dir?: string;
  path: string;
}

/** The pack id a reference names: an id, a pack's name or its folder. */
export function packIdOf(packs: readonly PackInfo[], ref: string): string {
  if (PACK_ID.test(ref) && packs.some((p) => p.id === ref)) return ref;
  const norm = (s: string) => s.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const want = norm(ref);
  const hits = packs.filter((p) => p.name.toLowerCase() === ref.toLowerCase() || norm(p.dir ?? "") === want || norm(p.path) === want || norm(p.dir ?? "").endsWith(`/${want}`));
  if (hits.length === 1) return hits[0]!.id;
  const list = packs.map((p) => `${p.id} "${p.name}"`).join(", ") || "none";
  throw new ToolError(hits.length ? "ambiguous" : "not_found", `${hits.length ? "Several packs match" : "No pack matches"} "${ref}". Packs: ${list}.`);
}

/** Agent names as people know them, from MCP client names. */
const KNOWN: [RegExp, string][] = [
  [/^claude[-_ ]?code/i, "Claude Code"],
  [/^claude[-_ ]?(ai|desktop)/i, "Claude Desktop"],
  [/^codex/i, "Codex"],
  [/^cursor/i, "Cursor"],
  [/^gemini/i, "Gemini CLI"],
  [/^(vscode|visual studio code)/i, "VS Code"],
  [/^windsurf/i, "Windsurf"],
  [/^opencode/i, "OpenCode"],
  [/^amp/i, "Amp"],
];

/** A caller's name from what its MCP client calls itself (`claude-code` → `Claude Code`). */
export function agentName(raw: string | undefined): string | null {
  const name = raw?.trim();
  if (!name) return null;
  return (KNOWN.find(([re]) => re.test(name))?.[1] ?? name).slice(0, 60);
}

function record(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** The name the client gave in this request (modern MCP) or at initialize (one connection). */
function clientInfoName(server: McpServer, ctx: ServerContext): string | undefined {
  const meta = record(ctx.mcpReq._meta);
  const info = record(meta?.[CLIENT_INFO_META_KEY]) ?? record(record(ctx.mcpReq.envelope)?.clientInfo);
  if (typeof info?.name === "string") return info.name;
  return server.server.getClientVersion()?.name;
}

export interface McpServerOptions {
  version: string;
  actions: readonly ActionInfo[];
  door: ToolDoor;
  /** Who calls, given the name the MCP client calls itself (null when it gives none): an explicit name wins over it. */
  caller: (clientInfo: string | null) => string;
}

const MAX_TEXT = 200_000;

/** A server with the tools for these actions. A fresh one per HTTP request or stdio connection. */
export function buildMcpServer(opts: McpServerOptions): McpServer {
  const server = new McpServer(
    { name: "watchwright", title: "Watchwright", version: opts.version },
    {
      capabilities: { tools: {} },
      instructions:
        "Watchwright runs browser test packs and shows each run live on its web page. Start with list_packs, run with start_run, follow with wait_for_run (call it again while the run goes), then read get_run and get_attempt. Tell the person the run's page address so they can watch. Deleting asks the person first.",
    },
  );
  const byName = new Map(opts.actions.map((a) => [a.name, a]));
  const caller = (ctx: ServerContext) => opts.caller(agentName(clientInfoName(server, ctx)));

  const resolvePack = async (a: ActionInfo, input: Record<string, unknown>, client: string, signal: AbortSignal) => {
    const field = packField(a);
    const ref = field ? input[field] : undefined;
    if (typeof ref !== "string" || PACK_ID.test(ref)) return input;
    const list = byName.get("packs.list");
    if (!list) return input;
    const packs = (await opts.door.call(list, {}, client, signal)).data as PackInfo[];
    return { ...input, [field!]: packIdOf(packs, ref) };
  };

  const run = async (a: ActionInfo, raw: Record<string, unknown>, ctx: ServerContext): Promise<CallToolResult> => {
    const client = caller(ctx);
    const signal = ctx.mcpReq.signal;
    try {
      const input = await resolvePack(a, withDefaults(a.input, raw), client, signal);
      const out = await opts.door.call(a, input, client, signal);
      return resultOf(a, out);
    } catch (err) {
      if (err instanceof ToolError) return errorResult(err.code, err.message, err.detail);
      throw err;
    }
  };

  for (const tool of toolsOf(opts.actions)) {
    const config = {
      title: tool.annotations.title ?? tool.name,
      description: tool.description,
      inputSchema: fromJsonSchema<Record<string, unknown>>(tool.input as JsonSchemaType),
      ...(tool.output ? { outputSchema: fromJsonSchema<Record<string, unknown>>(tool.output as JsonSchemaType) } : {}),
      annotations: tool.annotations,
    };
    if (tool.action) {
      const a = tool.action;
      server.registerTool(tool.name, config, (input, ctx) => run(a, input, ctx));
    } else {
      server.registerTool(tool.name, config, (input, ctx) => {
        const name = String(input.name);
        const a = byName.get(name);
        if (!a) return errorResult("unknown_action", `There is no action ${name}. list_actions lists them.`);
        return run(a, record(input.input) ?? {}, ctx);
      });
    }
  }
  return server;
}

function errorResult(code: string, message: string, detail?: unknown): CallToolResult {
  const text = `${code}: ${message}${detail === undefined ? "" : `\n${JSON.stringify(detail)}`}`;
  return { isError: true, content: [{ type: "text", text: text.slice(0, MAX_TEXT) }] };
}

/** The answer as content: JSON text, an image for a screenshot, the waiting message for an approval. */
function resultOf(a: ActionInfo, out: { status: number; data: unknown }): CallToolResult {
  const data = out.data;
  if (out.status === 202) {
    const message = record(data)?.message;
    return { content: [{ type: "text", text: `${typeof message === "string" ? message : "Waiting for the person's approval."}\n${JSON.stringify(data)}` }] };
  }
  const file = record(data);
  if (a.name === "runs.file" && file?.encoding === "base64" && typeof file.data === "string" && typeof file.mimeType === "string") {
    const { data: bytes, ...about } = file;
    return { content: [{ type: "image", data: bytes, mimeType: file.mimeType }, { type: "text", text: JSON.stringify(about) }] };
  }
  if (a.name === "runs.file" && file?.encoding === "utf8" && typeof file.data === "string") {
    const { data: text, ...about } = file;
    return { content: [{ type: "text", text: JSON.stringify(about) }, { type: "text", text: text.slice(0, MAX_TEXT) }] };
  }
  // A look at a page (explore_look, and explore_do's answer): the screenshot as an image, the snapshot as text of its own.
  const look = file && (a.name === "record.look" ? file : a.name === "record.do" ? record(file.look) : null);
  if (file && look && typeof look.snapshot === "string") {
    const { shot, snapshot, ...about } = look;
    const rest = look === file ? about : { ...file, look: about };
    const s = record(shot);
    const image: CallToolResult["content"] = s && typeof s.data === "string" && typeof s.mimeType === "string" ? [{ type: "image", data: s.data, mimeType: s.mimeType }] : [];
    return { content: [{ type: "text", text: JSON.stringify(rest).slice(0, MAX_TEXT) }, { type: "text", text: snapshot }, ...image] };
  }
  const text = JSON.stringify(data) ?? "null";
  const result: CallToolResult = {
    content: [{ type: "text", text: text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}… (cut at ${MAX_TEXT} characters)` : text }],
  };
  if (a.output?.type === "object" && record(data)) result.structuredContent = data as Record<string, unknown>;
  return result;
}
