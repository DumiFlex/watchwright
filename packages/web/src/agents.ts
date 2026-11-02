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

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * The line or JSON that connects each agent to the server at `origin`. With login on (`auth`), each
 * sends the person's API token: `token` when one was just made for it, else read from the
 * WATCHWRIGHT_TOKEN environment variable (Codex always reads it from there).
 */
export function connectSnippets(origin: string, auth?: { token?: string | undefined }): ConnectSnippet[] {
  const url = mcpAddress(origin);
  const { hostname, port } = new URL(origin);
  // The stdio bridge on this machine needs only another port; on another machine, the whole address.
  const server = LOOPBACK.has(hostname) ? (port && port !== "7420" ? port : null) : origin;
  const stdioArgs = server ? ["mcp", "--server", server] : ["mcp"];
  const token = auth?.token;
  // One line, spaced the way people write it: { "mcpServers": { "watchwright": { … } } }.
  const json = (o: unknown) => JSON.stringify(o, null, 1).replace(/\n\s*/g, " ").replace(/\[ /g, "[").replace(/ \]/g, "]");
  const claudeHeader = auth ? ` --header "Authorization: Bearer ${token ?? "$WATCHWRIGHT_TOKEN"}"` : "";
  const cursor = auth ? { url, headers: { Authorization: `Bearer ${token ?? "${env:WATCHWRIGHT_TOKEN}"}` } } : { url };
  const desktop = { command: "watchwright", args: stdioArgs, ...(auth ? { env: { WATCHWRIGHT_TOKEN: token ?? "<your token>" } } : {}) };
  return [
    { value: "claude", label: "Claude Code", where: "Run in a terminal, in your project (add --scope user for every project):", code: `claude mcp add --transport http watchwright ${url}${claudeHeader}`, lang: "text" },
    {
      value: "codex",
      label: "Codex",
      where: auth ? "Run in a terminal once, and set WATCHWRIGHT_TOKEN to the token where Codex runs:" : "Run in a terminal once; Codex keeps it in its own settings:",
      code: `codex mcp add watchwright --url ${url}${auth ? " --bearer-token-env-var WATCHWRIGHT_TOKEN" : ""}`,
      lang: "text",
    },
    { value: "cursor", label: "Cursor", where: "Put in .cursor/mcp.json in your project:", code: json({ mcpServers: { watchwright: cursor } }), lang: "json" },
    {
      value: "desktop",
      label: "Claude Desktop",
      where: "Put in Claude Desktop's settings file (Settings, Developer, Edit config). It starts watchwright mcp, which talks to this server:",
      code: json({ mcpServers: { watchwright: desktop } }),
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
