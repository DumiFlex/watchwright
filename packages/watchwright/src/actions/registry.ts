import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { errorBody } from "../server/errors.js";

// Every operation is declared once as an action: a name, an HTTP method and path, a JSON Schema
// for its input and a handler. The server builds the HTTP route (with validation) from it, the CLI
// a command and the MCP server a tool (docs/plan.md, section 3; docs/plans/step-5.md, section 2).

/** The subset of JSON Schema actions use for their input. */
export interface JsonSchema {
  type?: "object" | "string" | "integer" | "number" | "boolean" | "array";
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: readonly string[];
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  anyOf?: readonly JsonSchema[];
  enum?: readonly unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  pattern?: string;
  default?: unknown;
}

export type ObjectSchema = JsonSchema & { type: "object"; properties: Record<string, JsonSchema> };

export interface ActionCall {
  /** Who asked: `web`, `api`, later `cli` or an agent's name (from the `x-watchwright-client` header). */
  client: string;
  /** Aborted when the HTTP client goes away (for actions that wait). */
  signal: AbortSignal;
  /** True when the request comes from the web page (it carries the server's own Origin, which a browser sets and scripts don't). */
  fromPage: boolean;
}

export interface Action<I = Record<string, unknown>, O = unknown> {
  /** `<plugin>.<verb>` or `<plugin>.<noun>.<verb>`, lowercase. */
  name: string;
  /** One line for people and agents. */
  title: string;
  method: "GET" | "POST" | "DELETE";
  /** Path under /api/v1, with `:name` parameters that must also be input properties. */
  path: string;
  input?: ObjectSchema;
  /** HTTP status on success (default 200). */
  status?: number;
  /** JSON Schema of the `data` it answers with, where it is worth stating (MCP sends it as the tool's output schema). */
  output?: JsonSchema;
  /** Offered to agents as an MCP tool under this name; `say` is added to the title for agents. */
  agent?: { tool: string; say?: string };
  /** Deletes data or stops the server: called from anywhere but the web page, it waits for the person's approval (the `ACTION_GATE`). */
  destructive?: boolean;
  /** What a call would do, in words for the person approving it ("Delete run 3f2a… and its files"). */
  explain?: (input: I) => string | Promise<string>;
  handler: (input: I, call: ActionCall) => O | Promise<O>;
}

/** An error an action throws on purpose; becomes the error envelope with this status. */
export class ActionError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
    readonly detail?: unknown,
  ) {
    super(message);
  }
}

/** Asked before a destructive action runs; resolves to null to run it now, or to the answer to send instead. */
export type ActionGate = (req: GateRequest) => Promise<{ status: number; data: unknown } | null>;

export interface GateRequest {
  action: Action;
  input: Record<string, unknown>;
  call: ActionCall;
  /** A person said yes at a terminal (the CLI's prompt). */
  confirmed: boolean;
}

/** Identity helper with type checking for the handler's input. */
export function defineAction<I = Record<string, unknown>, O = unknown>(action: Action<I, O>): Action {
  return action as unknown as Action;
}

const NAME = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;
const TOOL = /^[a-z][a-z0-9_]{1,62}$/;

export function checkActions(actions: readonly Action[]): void {
  const names = new Set<string>();
  const routes = new Set<string>();
  const tools = new Set<string>();
  for (const a of actions) {
    if (!NAME.test(a.name)) throw new Error(`Action name "${a.name}" must look like "runs.start".`);
    if (names.has(a.name)) throw new Error(`Two actions are named "${a.name}".`);
    names.add(a.name);
    const route = `${a.method} ${a.path.replace(/:[a-zA-Z]+/g, ":")}`;
    if (routes.has(route)) throw new Error(`Two actions use the route ${a.method} ${a.path}.`);
    routes.add(route);
    if (a.agent) {
      if (!TOOL.test(a.agent.tool)) throw new Error(`Action "${a.name}": tool name "${a.agent.tool}" must be snake_case, like "start_run".`);
      if (tools.has(a.agent.tool)) throw new Error(`Two actions are the tool "${a.agent.tool}".`);
      tools.add(a.agent.tool);
    }
    for (const p of pathParams(a.path)) {
      if (!a.input?.properties[p]) throw new Error(`Action "${a.name}": path parameter :${p} must be an input property.`);
    }
  }
}

export function pathParams(path: string): string[] {
  return [...path.matchAll(/:([a-zA-Z]+)/g)].map((m) => m[1]!);
}

function pick(schema: ObjectSchema, keys: readonly string[], keep: boolean): ObjectSchema {
  const properties: Record<string, JsonSchema> = {};
  for (const [k, v] of Object.entries(schema.properties)) if (keys.includes(k) === keep) properties[k] = v;
  const required = (schema.required ?? []).filter((k) => keys.includes(k) === keep);
  return { type: "object", properties, required, additionalProperties: false };
}

/**
 * Runs an action's handler, asking the gate first when the action is destructive. Every door (HTTP,
 * MCP) calls actions through here, so none of them skips the approval. Throws what the handler throws.
 */
export async function invokeAction(action: Action, input: Record<string, unknown>, call: ActionCall, gate: ActionGate | null, confirmed = false): Promise<{ status: number; data: unknown }> {
  if (action.destructive && gate) {
    const held = await gate({ action, input, call, confirmed });
    if (held) return held;
  }
  return { status: action.status ?? 200, data: (await action.handler(input, call)) ?? null };
}

/** Mounts every action as a Fastify route: path parameters from the path, the rest from the query (GET) or body. */
export function mountActions(app: FastifyInstance, actions: readonly Action[], gate: () => ActionGate | null = () => null): void {
  for (const action of actions) {
    const params = pathParams(action.path);
    const input = action.input ?? { type: "object", properties: {} };
    const schema: Record<string, ObjectSchema> = {};
    if (params.length > 0) schema.params = pick(input, params, true);
    const rest = pick(input, params, false);
    if (action.method === "GET" || action.method === "DELETE") schema.querystring = rest;
    else schema.body = rest;
    app.route({
      method: action.method,
      url: action.path,
      schema,
      // An empty POST (no body, no content type) is the same as `{}`.
      preValidation: async (req) => {
        if (req.body === undefined || req.body === null) req.body = {};
      },
      handler: async (req: FastifyRequest, reply: FastifyReply) => {
        const merged = {
          ...((req.body as Record<string, unknown> | null) ?? {}),
          ...((req.query as Record<string, unknown> | null) ?? {}),
          ...((req.params as Record<string, unknown> | null) ?? {}),
        };
        const controller = new AbortController();
        // The response's close event fires early only when the client went away.
        const onClose = () => {
          if (!reply.raw.writableFinished) controller.abort();
        };
        reply.raw.on("close", onClose);
        try {
          const client = String(req.headers["x-watchwright-client"] ?? "api").slice(0, 60);
          // The request guard already refused other origins, so an Origin header here is our own page.
          const call: ActionCall = { client, signal: controller.signal, fromPage: typeof req.headers.origin === "string" };
          const out = await invokeAction(action, merged, call, gate(), req.headers["x-watchwright-confirmed"] === "terminal");
          return reply.code(out.status).send({ data: out.data ?? null });
        } catch (err) {
          if (err instanceof ActionError) return reply.code(err.status).send(errorBody(err.code, err.message, err.detail));
          throw err;
        } finally {
          reply.raw.off("close", onClose);
        }
      },
    });
  }
}

export interface ActionInfo {
  name: string;
  title: string;
  method: Action["method"];
  path: string;
  input: ObjectSchema;
  output?: JsonSchema;
  agent?: { tool: string; say?: string };
  destructive?: boolean;
}

/** The public description of an action (for `GET /actions`, the CLI and the MCP server). */
export function describeAction(a: Action): ActionInfo {
  return {
    name: a.name,
    title: a.title,
    method: a.method,
    path: `/api/v1${a.path}`,
    input: a.input ?? { type: "object", properties: {} },
    ...(a.output ? { output: a.output } : {}),
    ...(a.agent ? { agent: a.agent } : {}),
    ...(a.destructive ? { destructive: true } : {}),
  };
}
