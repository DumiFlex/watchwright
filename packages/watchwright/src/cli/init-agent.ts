import { parseArgs } from "node:util";
import { AGENT_NAMES, AGENTS, installAgents, mcpUrl, TOKEN_ENV, type AgentKind } from "../plugins/agents/install.js";
import { UsageError } from "./args.js";
import { serverUrl } from "./client.js";
import { EXIT, type Io } from "./commands.js";

// `watchwright init-agent [folder] [--agent claude,codex,cursor] [--no-mcp] [--auth]`: the skill and the MCP
// settings into a project, on this machine (no server needed). The action agents.install does the
// same from the web page.

/** Whether the server at `base` has login on; false when nothing answers (it may not run yet). */
async function loginOn(base: string): Promise<boolean> {
  const res = await fetch(`${base}api/v1/health`, { signal: AbortSignal.timeout(2000) }).catch(() => null);
  const body = (await res?.json().catch(() => null)) as { data?: { login?: { on?: boolean } } } | null;
  return body?.data?.login?.on === true;
}

export async function initAgentCommand(io: Io, argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { agent: { type: "string", multiple: true }, "no-mcp": { type: "boolean" }, server: { type: "string" }, auth: { type: "boolean" } },
  });
  if (positionals.length > 1) throw new UsageError("Usage: watchwright init-agent [folder] [--agent claude,codex,cursor] [--no-mcp] [--auth]");
  const agents = (values.agent ?? []).flatMap((a) => a.split(",")).map((a) => a.trim().toLowerCase()).filter(Boolean);
  const bad = agents.filter((a) => !(AGENTS as readonly string[]).includes(a));
  if (bad.length) throw new UsageError(`--agent takes ${AGENTS.join(", ")}, not ${bad.join(", ")}.`);
  const base = serverUrl(values.server);
  // With login on, the settings send the token from WATCHWRIGHT_TOKEN; --auth says so when the server isn't up to ask.
  const auth = !values["no-mcp"] && (values.auth === true || (await loginOn(base)));
  let r;
  try {
    r = installAgents({ folder: positionals[0] ?? process.cwd(), agents: agents as AgentKind[], mcp: !values["no-mcp"], url: mcpUrl(base), auth });
  } catch (err) {
    io.err(err instanceof Error ? err.message : String(err));
    return EXIT.failed;
  }
  io.out(`Set up ${r.agents.map((a) => AGENT_NAMES[a]).join(", ")} in ${r.folder}:`);
  for (const w of r.wrote) io.out(`  wrote ${w}`);
  for (const c of r.commands) io.out(`Run this once to give Codex the MCP server:\n  ${c}`);
  if (auth) io.out(`The server has login on: set ${TOKEN_ENV} to your API token where the agent runs (make one in Settings › Your account, or with \`watchwright login\`).`);
  for (const p of r.problems) io.err(p);
  return r.problems.length ? EXIT.failed : EXIT.ok;
}
