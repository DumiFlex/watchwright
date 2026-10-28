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

  it("tells the stdio bridge another port", () => {
    expect(JSON.parse(connectSnippets("http://localhost:7491")[3]!.code).mcpServers.watchwright.args).toEqual(["mcp", "--server", "7491"]);
  });
});
