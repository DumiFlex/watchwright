import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { copySkill } from "./skill.js";

// `watchwright init-agent` and the action `agents.install`: puts the skill where each agent looks
// for skills in a project, and the MCP server into the project's MCP settings
// (docs/plans/step-5.md, section 5). Settings files are merged, never trimmed; only the skill's own
// folder is replaced.

export const AGENTS = ["claude", "codex", "cursor"] as const;
export type AgentKind = (typeof AGENTS)[number];

export const AGENT_NAMES: Record<AgentKind, string> = { claude: "Claude Code", codex: "Codex", cursor: "Cursor" };

/** Where each agent reads a project's skills (Codex and Cursor share the open `.agents` folder). */
const SKILL_HOME: Record<AgentKind, string> = { claude: ".claude/skills", codex: ".agents/skills", cursor: ".agents/skills" };

export interface InstallOptions {
  folder: string;
  /** The agents to write for; none given: those whose folders the project has, else all. */
  agents?: readonly AgentKind[];
  /** Also add the MCP server to the project's settings (default true). */
  mcp?: boolean;
  /** The server's MCP address. */
  url: string;
}

export interface InstallResult {
  folder: string;
  agents: AgentKind[];
  /** Files and folders written, relative to the project. */
  wrote: string[];
  /** Commands to run by hand: Codex keeps MCP servers in its own settings. */
  commands: string[];
  /** What couldn't be done, such as a settings file that isn't valid JSON. */
  problems: string[];
}

/** The agents a project is set up for, by the folders it has. */
export function agentsIn(folder: string): AgentKind[] {
  const has = (p: string) => existsSync(path.join(folder, p));
  return AGENTS.filter((a) => (a === "claude" ? has(".claude") || has(".mcp.json") : a === "codex" ? has(".codex") || has(".agents") : has(".cursor")));
}

/** The MCP address of a server: `http://127.0.0.1:7420/` → `http://127.0.0.1:7420/api/v1/mcp`. */
export function mcpUrl(server: string): string {
  return new URL("api/v1/mcp", server.endsWith("/") ? server : `${server}/`).href;
}

/** The line that adds the server to Codex. */
export function codexCommand(url: string): string {
  return `codex mcp add watchwright --url ${url}`;
}

/** Sets `mcpServers.watchwright` in a JSON settings file, keeping everything else. */
function mergeMcp(file: string, entry: Record<string, unknown>): string | null {
  let json: Record<string, unknown> = {};
  if (existsSync(file)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "isn't a JSON object";
      json = parsed as Record<string, unknown>;
    } catch {
      return "isn't valid JSON";
    }
  }
  const servers = json.mcpServers;
  if (servers !== undefined && (!servers || typeof servers !== "object" || Array.isArray(servers))) return "has an mcpServers that isn't an object";
  json.mcpServers = { ...(servers as Record<string, unknown> | undefined), watchwright: entry };
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
  return null;
}

export function installAgents(opts: InstallOptions): InstallResult {
  const folder = path.resolve(opts.folder);
  if (!existsSync(folder)) throw new Error(`There's no folder ${folder}.`);
  const found = agentsIn(folder);
  const agents = opts.agents?.length ? [...new Set(opts.agents)] : found.length ? found : [...AGENTS];
  const result: InstallResult = { folder, agents, wrote: [], commands: [], problems: [] };
  for (const home of new Set(agents.map((a) => SKILL_HOME[a]))) {
    const rel = `${home}/watchwright`;
    const dest = path.join(folder, ...rel.split("/"));
    rmSync(dest, { recursive: true, force: true });
    copySkill(dest);
    result.wrote.push(`${rel}/`);
  }
  if (opts.mcp !== false) {
    const merge = (rel: string, entry: Record<string, unknown>) => {
      const problem = mergeMcp(path.join(folder, ...rel.split("/")), entry);
      if (problem) result.problems.push(`${rel} ${problem}, so it was left as it is. Add the watchwright server to it by hand.`);
      else result.wrote.push(rel);
    };
    if (agents.includes("claude")) merge(".mcp.json", { type: "http", url: opts.url });
    if (agents.includes("cursor")) merge(".cursor/mcp.json", { url: opts.url });
    if (agents.includes("codex")) result.commands.push(codexCommand(opts.url));
  }
  return result;
}
