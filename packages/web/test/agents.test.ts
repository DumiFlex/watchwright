import { describe, expect, it } from "vitest";
import { connectSnippets, mcpAddress } from "../src/agents";

describe("connecting agents", () => {
  it("gives each agent the server's own MCP address", () => {
    expect(mcpAddress("http://127.0.0.1:7420")).toBe("http://127.0.0.1:7420/api/v1/mcp");
    const s = connectSnippets("http://127.0.0.1:7420");
    expect(s.map((x) => x.label)).toEqual(["Claude Code", "Codex", "Cursor", "Claude Desktop"]);
    expect(s[0]!.code).toBe("claude mcp add --transport http watchwright http://127.0.0.1:7420/api/v1/mcp");
    expect(s[1]!.code).toBe("codex mcp add watchwright --url http://127.0.0.1:7420/api/v1/mcp");
    expect(JSON.parse(s[2]!.code)).toEqual({ mcpServers: { watchwright: { url: "http://127.0.0.1:7420/api/v1/mcp" } } });
    expect(JSON.parse(s[3]!.code)).toEqual({ mcpServers: { watchwright: { command: "watchwright", args: ["mcp"] } } });
  });

  it("tells the stdio bridge another port, or the whole address of another machine", () => {
    expect(JSON.parse(connectSnippets("http://localhost:7491")[3]!.code).mcpServers.watchwright.args).toEqual(["mcp", "--server", "7491"]);
    expect(JSON.parse(connectSnippets("https://ww.example.com")[3]!.code).mcpServers.watchwright.args).toEqual(["mcp", "--server", "https://ww.example.com"]);
  });

  it("sends the person's token with login on", () => {
    const env = connectSnippets("https://ww.example.com", {});
    expect(env[0]!.code).toBe('claude mcp add --transport http watchwright https://ww.example.com/api/v1/mcp --header "Authorization: Bearer $WATCHWRIGHT_TOKEN"');
    expect(env[1]!.code).toBe("codex mcp add watchwright --url https://ww.example.com/api/v1/mcp --bearer-token-env-var WATCHWRIGHT_TOKEN");
    expect(JSON.parse(env[2]!.code).mcpServers.watchwright.headers).toEqual({ Authorization: "Bearer ${env:WATCHWRIGHT_TOKEN}" });
    const made = connectSnippets("https://ww.example.com", { token: "ww_abc" });
    expect(made[0]!.code).toContain('--header "Authorization: Bearer ww_abc"');
    expect(made[1]!.code).toContain("--bearer-token-env-var WATCHWRIGHT_TOKEN");
    expect(JSON.parse(made[2]!.code).mcpServers.watchwright.headers).toEqual({ Authorization: "Bearer ww_abc" });
    expect(JSON.parse(made[3]!.code).mcpServers.watchwright.env).toEqual({ WATCHWRIGHT_TOKEN: "ww_abc" });
  });
});
