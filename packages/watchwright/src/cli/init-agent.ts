import { parseArgs } from "node:util";
import { AGENT_NAMES, AGENTS, installAgents, mcpUrl, type AgentKind } from "../plugins/agents/install.js";
import { UsageError } from "./args.js";
import { serverUrl } from "./client.js";
import { EXIT, type Io } from "./commands.js";

// `watchwright init-agent [folder] [--agent claude,codex,cursor] [--no-mcp]`: the skill and the MCP
// settings into a project, on this machine (no server needed). The action agents.install does the
// same from the web page.

export function initAgentCommand(io: Io, argv: string[]): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { agent: { type: "string", multiple: true }, "no-mcp": { type: "boolean" }, server: { type: "string" } },
  });
  if (positionals.length > 1) throw new UsageError("Usage: watchwright init-agent [folder] [--agent claude,codex,cursor] [--no-mcp]");
  const agents = (values.agent ?? []).flatMap((a) => a.split(",")).map((a) => a.trim().toLowerCase()).filter(Boolean);
  const bad = agents.filter((a) => !(AGENTS as readonly string[]).includes(a));
  if (bad.length) throw new UsageError(`--agent takes ${AGENTS.join(", ")}, not ${bad.join(", ")}.`);
  let r;
  try {
    r = installAgents({ folder: positionals[0] ?? process.cwd(), agents: agents as AgentKind[], mcp: !values["no-mcp"], url: mcpUrl(serverUrl(values.server)) });
  } catch (err) {
    io.err(err instanceof Error ? err.message : String(err));
    return EXIT.failed;
  }
  io.out(`Set up ${r.agents.map((a) => AGENT_NAMES[a]).join(", ")} in ${r.folder}:`);
  for (const w of r.wrote) io.out(`  wrote ${w}`);
  for (const c of r.commands) io.out(`Run this once to give Codex the MCP server:\n  ${c}`);
  for (const p of r.problems) io.err(p);
  return r.problems.length ? EXIT.failed : EXIT.ok;
}
