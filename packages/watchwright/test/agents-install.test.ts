import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client as McpClient, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { parse } from "yaml";
import { afterEach, describe, expect, it } from "vitest";
import { initAgentCommand } from "../src/cli/init-agent.js";
import type { Io } from "../src/cli/commands.js";
import { agentsIn, codexCommand, installAgents, mcpUrl } from "../src/plugins/agents/install.js";
import { references, referenceOf, SKILL_DIR } from "../src/plugins/agents/skill.js";
import type { SeenAgent } from "../src/plugins/agents/seen.js";
import { cleanTempDirs, tempDir, writeFiles } from "./helpers/fixtures.js";
import { startHarness, type Harness } from "./helpers/harness.js";

// The agent skill in the package, `watchwright init-agent` / agents.install, and who called lately.

const harnesses: Harness[] = [];
afterEach(async () => {
  for (const h of harnesses.splice(0)) await h.close();
  cleanTempDirs();
});

const URL_ = "http://127.0.0.1:7420/api/v1/mcp";
const json = (file: string) => JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;

describe("the skill", () => {
  it("has front matter agents accept", () => {
    const text = readFileSync(path.join(SKILL_DIR, "SKILL.md"), "utf8");
    const front = /^---\n([\s\S]*?)\n---\n/.exec(text);
    expect(front).not.toBeNull();
    const meta = parse(front![1]!) as { name: string; description: string };
    expect(meta.name).toBe("watchwright");
    expect(meta.name).toMatch(/^[a-z0-9-]{1,64}$/);
    expect(meta.description.length).toBeGreaterThan(50);
    expect(meta.description.length).toBeLessThanOrEqual(1024);
    expect(text.split("\n").length).toBeLessThan(500);
    // Every reference it links to is there.
    for (const m of text.matchAll(/\]\((references\/[^)]+)\)/g)) expect(existsSync(path.join(SKILL_DIR, m[1]!))).toBe(true);
  });

  it("carries the docs site's pages as they are (pnpm --filter watchwright skill-references)", () => {
    const site = fileURLToPath(new URL("../../site/", import.meta.url));
    for (const [file, text] of references(site)) expect(readFileSync(path.join(SKILL_DIR, "references", file), "utf8"), file).toBe(text);
  });

  it("points links at its own files or the published site, and turns boxes into quotes", () => {
    const out = referenceOf("guide/yaml-tests", "See [steps](../reference/yaml-steps#targets), [API](../reference/http-api) and [here](#files).\n\n::: warning Careful\nIt bites.\n:::\n");
    expect(out).toContain("[steps](yaml-steps.md#targets)");
    expect(out).toContain("[API](https://dumiflex.github.io/watchwright/reference/http-api)");
    expect(out).toContain("[here](#files)");
    expect(out).toContain("> **Careful**\n>\n> It bites.\n");
  });
});

describe("installing into a project", () => {
  it("writes for the agents whose folders the project has, and merges their MCP settings", () => {
    const dir = tempDir("ww-proj-");
    writeFiles(dir, { ".cursor/mcp.json": JSON.stringify({ mcpServers: { other: { url: "http://x" } }, keep: 1 }), ".claude/settings.json": "{}" });
    expect(agentsIn(dir)).toEqual(["claude", "cursor"]);
    const r = installAgents({ folder: dir, url: URL_ });
    expect(r.agents).toEqual(["claude", "cursor"]);
    expect(r.wrote).toEqual([".claude/skills/watchwright/", ".agents/skills/watchwright/", ".mcp.json", ".cursor/mcp.json"]);
    expect(existsSync(path.join(dir, ".claude/skills/watchwright/SKILL.md"))).toBe(true);
    expect(existsSync(path.join(dir, ".agents/skills/watchwright/references/yaml-steps.md"))).toBe(true);
    expect(json(path.join(dir, ".mcp.json"))).toEqual({ mcpServers: { watchwright: { type: "http", url: URL_ } } });
    expect(json(path.join(dir, ".cursor/mcp.json"))).toEqual({ mcpServers: { other: { url: "http://x" }, watchwright: { url: URL_ } }, keep: 1 });
    expect(r.commands).toEqual([]);
  });

  it("writes for all three in a bare project, gives Codex a command, and leaves broken settings alone", () => {
    const dir = tempDir("ww-proj-");
    writeFiles(dir, { ".mcp.json": "{ nope" });
    const r = installAgents({ folder: dir, agents: ["claude", "codex"], url: URL_ });
    expect(r.commands).toEqual([codexCommand(URL_)]);
    expect(r.problems[0]).toMatch(/^\.mcp\.json isn't valid JSON/);
    expect(readFileSync(path.join(dir, ".mcp.json"), "utf8")).toBe("{ nope");
    const bare = tempDir("ww-proj-");
    expect(installAgents({ folder: bare, url: URL_, mcp: false })).toMatchObject({ agents: ["claude", "codex", "cursor"], wrote: [".claude/skills/watchwright/", ".agents/skills/watchwright/"] });
    expect(() => installAgents({ folder: path.join(bare, "missing"), url: URL_ })).toThrow(/no folder/);
  });

  it("does it from the command line", () => {
    const dir = tempDir("ww-proj-");
    const out: string[] = [];
    const err: string[] = [];
    const io: Io = { out: (s) => out.push(s), err: (s) => err.push(s), interactive: false, confirm: () => Promise.resolve(false) };
    expect(initAgentCommand(io, [dir, "--agent", "codex", "--server", "7491"])).toBe(0);
    expect(out.join("\n")).toContain("codex mcp add watchwright --url http://127.0.0.1:7491/api/v1/mcp");
    expect(() => initAgentCommand(io, [dir, "--agent", "vim"])).toThrow(/--agent takes/);
    expect(mcpUrl("http://127.0.0.1:7420")).toBe(URL_);
  });
});

describe("agents on the server", () => {
  it("installs through agents.install and lists who called lately", async () => {
    const h = await startHarness(tempDir("ww-data-"), { listen: true });
    harnesses.push(h);
    const dir = tempDir("ww-proj-");
    const r = await h.api<{ wrote: string[] }>("POST", "/agents/install", { folder: dir, agents: ["cursor"], server: `http://${h.host}/` });
    expect(r.status).toBe(200);
    expect(json(path.join(dir, ".cursor/mcp.json"))).toEqual({ mcpServers: { watchwright: { url: `http://${h.host}/api/v1/mcp` } } });
    expect((await h.api("POST", "/agents/install", { folder: path.join(dir, "missing") })).error?.code).toBe("install_failed");

    // MCP calls over HTTP are counted, and the stdio bridge reports its own.
    const mcp = new McpClient({ name: "claude-code", version: "1.0.0" });
    await mcp.connect(new StreamableHTTPClientTransport(new URL(`http://${h.host}/api/v1/mcp`)));
    await mcp.callTool({ name: "list_packs", arguments: {} });
    await mcp.callTool({ name: "start_run", arguments: { packId: "00000000" } });
    await mcp.close();
    const bridged = await fetch(`http://${h.host}/api/v1/agents/seen`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client: "Claude Desktop", tool: "list_runs" }) });
    expect(bridged.status).toBe(200);
    expect((await fetch(`http://${h.host}/api/v1/agents/seen`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status).toBe(400);

    const seen = (await h.api<SeenAgent[]>("GET", "/agents/seen")).data;
    expect(seen.map((a) => a.name)).toEqual(["Claude Desktop", "Claude Code"]);
    expect(seen[1]).toMatchObject({ lastTool: "start_run", calls: 2, started: 1 });
  });
});
