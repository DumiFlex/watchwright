import { Client as McpClient, StreamableHTTPClientTransport, type CallToolResult } from "@modelcontextprotocol/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Client } from "../src/cli/client.js";
import { actionCommand, EXIT, resultsCommand, runCommand, statusCommand, waitCommand, type Io } from "../src/cli/commands.js";
import type { RunDigest, RunFile, WaitResult } from "../src/plugins/runs/digest.js";
import { cleanTempDirs, startSite, tempDir, writeFiles } from "./helpers/fixtures.js";
import { engineOf, hasChromium, requireBrowsers, startHarness, type Harness } from "./helpers/harness.js";

// What agents use to follow a run, through the HTTP API and through the CLI's commands against a
// real listening server: the summary, the bounded wait, one control action, files, exit codes.

const run = hasChromium || requireBrowsers ? describe : describe.skip;

let site: { url: string; close(): Promise<void> };
const harnesses: Harness[] = [];
beforeAll(async () => {
  site = await startSite();
});
afterAll(async () => {
  await site.close();
});
afterEach(async () => {
  for (const h of harnesses.splice(0)) await h.close();
  cleanTempDirs();
});

function pack(): string {
  const dir = tempDir("ww-pack-");
  writeFiles(dir, {
    "pack.yaml": `name: Agent fixture
site: { key: agent-${Math.random().toString(36).slice(2, 8)}, baseURL: "${site.url}" }
browser: { viewport: { width: 800, height: 600 } }
run: { video: false }
`,
    "tests/t.yaml": `tests:
  - id: T1
    title: Count
    steps:
      - goto: /
      - click: "#inc"
      - shot: counted
  - id: T2
    title: Breaks
    steps:
      - goto: /
      - click: { target: "#gone", timeout: 200 }
  - id: T3
    title: Slow
    steps:
      - goto: /
      - wait: 1500
      - click: "#inc"
`,
  });
  return dir;
}

function io() {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { out: (s) => out.push(s), err: (s) => err.push(s), interactive: false, confirm: async () => false };
  return { io, out, err };
}

run("following a run as an agent", { timeout: 90_000 }, () => {
  it("waits for a pause on a broken attempt, retries through control, reads the summary and a screenshot", async () => {
    const h = await startHarness(tempDir("ww-data-"));
    harnesses.push(h);
    const added = await h.api<{ id: string }>("POST", "/packs", { path: pack() });
    const started = await h.api<{ id: string }>("POST", "/runs", { packId: added.data.id });
    const id = started.data.id;

    const first = await h.api<WaitResult>("GET", `/runs/${id}/wait?timeout=30`);
    expect(first.data.reason).toBe("paused");
    expect(first.data.run.live).toMatchObject({ state: "paused", pauseReason: "broken", testId: "T2" });
    expect(first.data.happened.map((x) => `${x.type}:${String(x.testId ?? "")}`)).toContain("attempt.finished:T1");

    // A wait with the cursor doesn't answer again for the same pause.
    const quiet = await h.api<WaitResult>("GET", `/runs/${id}/wait?after=${first.data.cursor}&timeout=0.3`);
    expect(quiet.data.reason).toBe("timeout");

    const skipped = await h.api<RunDigest>("POST", `/runs/${id}/control`, { do: "skip" });
    expect(skipped.status).toBe(200);
    const end = await h.api<WaitResult>("GET", `/runs/${id}/wait?after=${quiet.data.cursor}&timeout=30`);
    expect(end.data.reason).toBe("ended");
    expect(end.data.happened.map((x) => x.type)).toContain("run.finished");
    await engineOf(h).settled(id);

    const summary = (await h.api<RunDigest>("GET", `/runs/${id}/summary`)).data;
    expect(summary).toMatchObject({ status: "finished", page: `/#/runs/${id}`, counts: { passed: 2, broken: 1 } });
    const broken = summary.attempts.find((a) => a.testId === "T2")!;
    expect(broken.error).toMatch(/^step: /);

    const t1 = summary.attempts.find((a) => a.testId === "T1")!;
    const doc = (await h.api<{ artifacts: { path: string; contentType: string }[] }>("GET", `/runs/${id}/attempts/${t1.id}`)).data;
    const shot = doc.artifacts.find((a) => a.contentType === "image/png")!;
    const file = (await h.api<RunFile>("GET", `/runs/${id}/file?path=${encodeURIComponent(shot.path)}`)).data;
    expect(file).toMatchObject({ mimeType: "image/png", width: 800, height: 600, encoding: "base64" });
    expect(Buffer.from(file.data!, "base64").subarray(1, 4).toString()).toBe("PNG");
    const log = doc.artifacts.find((a) => a.contentType.startsWith("text/"));
    if (log) expect((await h.api<RunFile>("GET", `/runs/${id}/file?path=${encodeURIComponent(log.path)}`)).data.encoding).toBe("utf8");

    // Only the run's own files.
    expect((await h.api("GET", `/runs/${id}/file?path=${encodeURIComponent("runs/../../etc/passwd")}`)).status).toBe(404);
    expect((await h.api("GET", `/runs/${id}/file?path=${encodeURIComponent(`runs/${id}/../x`)}`)).status).toBe(404);
  });

  it("records who paused a run, and runs through the CLI's commands with exit codes", async () => {
    const h = await startHarness(tempDir("ww-data-"), { listen: true });
    harnesses.push(h);
    const client = new Client(`http://${h.host}/`, "Claude Code");
    await client.callName("packs.add", { path: pack() });

    const s = io();
    expect(await statusCommand(client, s.io, false)).toBe(EXIT.ok);
    expect(s.out.join("\n")).toContain("No runs are going.");

    // `run` resolves the pack by name and waits; the broken T2 pauses it.
    const r = io();
    expect(await runCommand(client, r.io, "agent fixture", ["T1", "T2"], { params: {}, wait: true, timeout: 30, json: false })).toBe(EXIT.runPaused);
    const id = /Started run ([0-9a-f]{8})/.exec(r.out[0]!)![1]!;
    expect(r.out.join("\n")).toMatch(/T1 passed[\s\S]*Paused on broken T2/);
    const runs = await client.callName<{ startedBy: string }[]>("runs.list");
    expect(runs[0]!.startedBy).toBe("Claude Code");

    // A generated command answers the pause; then wait sees the end with a failing exit code.
    const c = io();
    expect(await actionCommand(client, c.io, ["runs", "control", id, "--do", "skip"], "watchwright")).toBe(EXIT.ok);
    expect(JSON.parse(c.out[0]!)).toMatchObject({ id });
    const w = io();
    expect(await waitCommand(client, w.io, id, undefined, 30, false)).toBe(EXIT.runFailed);
    expect(w.out.at(-1)).toMatch(/Run finished\. 1 passed, 1 broken/);

    const res = io();
    expect(await resultsCommand(client, res.io, id, undefined, false)).toBe(EXIT.runFailed);
    expect(res.out.join("\n")).toMatch(/T2 {2}broken {2}step: /);

    // Pausing records the caller.
    const second = await client.callName<{ id: string }>("runs.start", { packId: (await client.callName<{ id: string }[]>("packs.list"))[0]!.id, tests: ["T3"] });
    await h.waitFor((e) => e.runId === second.id && e.type === "attempt.started", 20_000);
    await client.callName("runs.pause", { id: second.id });
    const paused = await client.callName<WaitResult>("runs.wait", { id: second.id, timeout: 20 });
    expect(paused.reason).toBe("paused");
    expect(paused.run.live).toMatchObject({ pauseReason: "manual", pausedBy: "Claude Code" });
    expect(paused.happened.find((x) => x.type === "run.paused")?.by).toBe("Claude Code");
    const w2 = io();
    expect(await waitCommand(client, w2.io, second.id, undefined, 5, false)).toBe(EXIT.runPaused);
    expect(w2.out.at(-1)).toMatch(/^Paused by Claude Code\./);
    await client.callName("runs.control", { id: second.id, do: "resume" });
    expect((await client.callName<WaitResult>("runs.wait", { id: second.id, timeout: 20 })).reason).toBe("ended");
    await engineOf(h).settled(second.id);

    // Errors: unknown commands and options are usage errors.
    const bad = io();
    expect(await actionCommand(client, bad.io, ["runs", "nope"], "watchwright")).toBe(EXIT.usage);
    expect(bad.err[0]).toContain("watchwright runs list");
  });
  it("runs a pack, waits and looks at a screenshot through the MCP tools", async () => {
    const h = await startHarness(tempDir("ww-data-"), { listen: true });
    harnesses.push(h);
    await h.api("POST", "/packs", { path: pack() });
    const mcp = new McpClient({ name: "codex-mcp-client", version: "1.0.0" });
    await mcp.connect(new StreamableHTTPClientTransport(new URL(`http://${h.host}/api/v1/mcp`)));
    try {
      const call = async (name: string, args: Record<string, unknown>) => (await mcp.callTool({ name, arguments: args })) as CallToolResult;
      const json = (r: CallToolResult) => JSON.parse(r.content[0]?.type === "text" ? r.content[0].text : "null") as Record<string, unknown>;

      // The pack by its name, as an agent says it.
      const started = await call("start_run", { packId: "Agent fixture", tests: ["T1"] });
      expect(started.isError).toBeFalsy();
      const id = String(json(started).id);
      let waited = json(await call("wait_for_run", { id, timeout: 30 }));
      while (waited.reason === "timeout") waited = json(await call("wait_for_run", { id, after: waited.cursor, timeout: 30 }));
      expect(waited.reason).toBe("ended");
      await engineOf(h).settled(id);

      const summary = json(await call("get_run", { id })) as unknown as RunDigest;
      expect(summary).toMatchObject({ status: "finished", startedBy: "Codex", counts: { passed: 1 } });
      const attempt = json(await call("get_attempt", { id, attemptId: summary.attempts[0]!.id })) as { artifacts: { path: string; contentType: string }[] };
      const shot = attempt.artifacts.find((a) => a.contentType === "image/png")!;
      const file = await call("get_file", { id, path: shot.path });
      expect(file.content[0]).toMatchObject({ type: "image", mimeType: "image/png" });
      expect(file.content[1]).toMatchObject({ type: "text" });
    } finally {
      await mcp.close();
    }
  });
});
