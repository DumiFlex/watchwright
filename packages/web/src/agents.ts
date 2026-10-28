// Settings > Agents: how each agent connects to this server's MCP address, and who called lately.

export type AgentTab = "claude" | "codex" | "cursor" | "desktop";

export interface ConnectSnippet {
  value: AgentTab;
  label: string;
  /** Where it goes, in a sentence. */
  where: string;
  code: string;
  lang: "text" | "json";
}

/** The MCP address of the server the page was loaded from. */
export function mcpAddress(origin: string): string {
  return new URL("/api/v1/mcp", origin).href;
}

/** The line or JSON that connects each agent to the server at `origin`. */
export function connectSnippets(origin: string): ConnectSnippet[] {
  const url = mcpAddress(origin);
  const port = new URL(origin).port;
  const stdioArgs = port && port !== "7420" ? `["mcp", "--server", "${port}"]` : `["mcp"]`;
  return [
    { value: "claude", label: "Claude Code", where: "Run in a terminal, in your project (add --scope user for every project):", code: `claude mcp add --transport http watchwright ${url}`, lang: "text" },
    { value: "codex", label: "Codex", where: "Run in a terminal once; Codex keeps it in its own settings:", code: `codex mcp add watchwright --url ${url}`, lang: "text" },
    { value: "cursor", label: "Cursor", where: "Put in .cursor/mcp.json in your project:", code: `{ "mcpServers": { "watchwright": { "url": "${url}" } } }`, lang: "json" },
    {
      value: "desktop",
      label: "Claude Desktop",
      where: "Put in Claude Desktop's settings file (Settings, Developer, Edit config). It starts watchwright mcp, which talks to this server:",
      code: `{ "mcpServers": { "watchwright": { "command": "watchwright", "args": ${stdioArgs} } } }`,
      lang: "json",
    },
  ];
}

export interface SeenAgent {
  name: string;
  firstAt: string;
  lastAt: string;
  lastTool: string;
  calls: number;
  started: number;
}

export type InstallAgent = "claude" | "codex" | "cursor";

export interface InstallResult {
  folder: string;
  agents: InstallAgent[];
  wrote: string[];
  commands: string[];
  problems: string[];
}
