import { describe, expect, it } from "vitest";
import { checkActions, defineAction, describeAction, type ActionInfo } from "../src/actions/registry.js";
import { actionHelp, coerce, kebab, parseActionArgs, UsageError } from "../src/cli/args.js";
import { clientName, serverUrl } from "../src/cli/client.js";
import { clock, EXIT, exitOf, findAction } from "../src/cli/commands.js";
import type { RunDigest } from "../src/plugins/runs/digest.js";
import { imageSize } from "../src/plugins/runs/digest.js";
import { missingBrowser } from "../src/session/session.js";

const start: ActionInfo = describeAction(
  defineAction({
    name: "runs.start",
    title: "Start a run",
    method: "POST",
    path: "/packs/:packId/runs/:mode",
    input: {
      type: "object",
      properties: {
        packId: { type: "string" },
        mode: { type: "string" },
        tests: { type: "array", items: { type: "string" } },
        params: { type: "object", additionalProperties: { anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }] } },
        attempts: { type: "integer", minimum: 1 },
        pauseOnBroken: { type: "boolean" },
        ratio: { type: "number" },
        trace: { type: "string", enum: ["problems", "always", "never"] },
      },
      required: ["packId"],
    },
    agent: { tool: "start_run", say: "Tell the person." },
    handler: () => null,
  }),
);

describe("CLI arguments from an action's schema", () => {
  it("takes path parameters in order and every property as a flag", () => {
    const { input } = parseActionArgs(start, ["0a1b2c3d", "normal", "--tests", "A1,A2", "--tests=B1", "--attempts", "3", "--pause-on-broken", "--ratio=0.5", "--trace", "always"]);
    expect(input).toEqual({ packId: "0a1b2c3d", mode: "normal", tests: ["A1", "A2", "B1"], attempts: 3, pauseOnBroken: true, ratio: 0.5, trace: "always" });
  });

  it("reads --no-x as false, and booleans followed by true or false", () => {
    expect(parseActionArgs(start, ["--no-pause-on-broken"]).input).toEqual({ pauseOnBroken: false });
    expect(parseActionArgs(start, ["--pauseOnBroken", "false"]).input).toEqual({ pauseOnBroken: false });
  });

  it("builds objects from JSON or key=value, with a singular flag for a plural property", () => {
    expect(parseActionArgs(start, ["--params", '{"n":2}', "--param", "lang=de"]).input).toEqual({ params: { n: 2, lang: "de" } });
  });

  it("keeps its own flags out of the input", () => {
    let file = "";
    const { input, own } = parseActionArgs(start, ["--json", "--input", "body.json", "--attempts", "1"], { ownFlags: ["json"], ownValues: { input: (v) => (file = v) } });
    expect(input).toEqual({ attempts: 1 });
    expect([...own]).toEqual(["json"]);
    expect(file).toBe("body.json");
  });

  it("says what is wrong", () => {
    expect(() => parseActionArgs(start, ["--nope", "1"])).toThrow(/Unknown option --nope for runs.start\. Options: --pack-id/);
    expect(() => parseActionArgs(start, ["--attempts", "two"])).toThrow(UsageError);
    expect(() => parseActionArgs(start, ["a", "b", "c"])).toThrow(/Too many arguments for runs.start: c/);
    expect(() => parseActionArgs(start, ["--trace"])).toThrow(/needs a value/);
    expect(() => parseActionArgs(start, ["--tests", "a", "--attempts", "1", "--attempts", "2"])).toThrow(/given twice/);
    expect(() => coerce("params", "{oops", start.input.properties.params!)).toThrow(/isn't valid JSON/);
  });

  it("prints help from the schema", () => {
    const help = actionHelp(start, "watchwright runs start");
    expect(help).toContain("watchwright runs start <packId> <mode>");
    expect(help).toContain("Tell the person.");
    expect(help).toContain("--trace <problems|always|never>");
    expect(help).toContain("Action runs.start: POST /api/v1/packs/:packId/runs/:mode");
  });

  it("finds an action by its words or its dotted name", () => {
    const actions = [start, { ...start, name: "runs.presets.save" }];
    expect(findAction(actions, ["runs", "presets", "save", "x"])).toMatchObject({ action: { name: "runs.presets.save" }, rest: ["x"] });
    expect(findAction(actions, ["runs.start", "x"])).toMatchObject({ action: { name: "runs.start" }, rest: ["x"] });
    expect(findAction(actions, ["runs", "nope"])).toBeNull();
  });
});

describe("the CLI's server and caller", () => {
  it("takes the server from the flag, the environment or the default", () => {
    expect(serverUrl(undefined, {})).toBe("http://127.0.0.1:7420/");
    expect(serverUrl("7421", {})).toBe("http://127.0.0.1:7421/");
    expect(serverUrl(undefined, { WATCHWRIGHT_URL: "localhost:9000" })).toBe("http://localhost:9000/");
    expect(serverUrl("http://127.0.0.1:1/x", {})).toBe("http://127.0.0.1:1/x/");
  });

  it("names the agent it runs under", () => {
    expect(clientName(undefined, {})).toBe("cli");
    expect(clientName(undefined, { CLAUDECODE: "1" })).toBe("Claude Code");
    expect(clientName(undefined, { CODEX_THREAD_ID: "t" })).toBe("Codex");
    expect(clientName(undefined, { CURSOR_TRACE_ID: "x", PAGER: "head -n 10000 | cat" })).toBe("Cursor");
    expect(clientName(undefined, { CURSOR_TRACE_ID: "x" })).toBe("cli");
    expect(clientName(undefined, { CLAUDECODE: "1", WATCHWRIGHT_CLIENT: "Nightly bot" })).toBe("Nightly bot");
    expect(clientName("Me", { CLAUDECODE: "1" })).toBe("Me");
  });
});

describe("exit codes", () => {
  const run = (status: string, counts: Record<string, number>) => ({ status, counts }) as unknown as RunDigest;
  it("tell an agent how a run went", () => {
    expect(exitOf("ended", run("finished", { passed: 3, skipped: 1 }))).toBe(EXIT.ok);
    expect(exitOf("ended", run("finished", { passed: 3, broken: 1 }))).toBe(EXIT.runFailed);
    expect(exitOf("ended", run("stopped", { passed: 3 }))).toBe(EXIT.runFailed);
    expect(exitOf("ended", run("failed_to_start", {}))).toBe(EXIT.failed);
    expect(exitOf("paused", run("paused", {}))).toBe(EXIT.runPaused);
    expect(exitOf("timeout", run("running", {}))).toBe(EXIT.runGoing);
  });
});

describe("action declarations for agents", () => {
  const base = { method: "GET" as const, title: "T", handler: () => null };
  it("checks tool names", () => {
    expect(() => checkActions([defineAction({ ...base, name: "a.b", path: "/a", agent: { tool: "Bad-Name" } })])).toThrow(/snake_case/);
    expect(() =>
      checkActions([defineAction({ ...base, name: "a.b", path: "/a", agent: { tool: "same" } }), defineAction({ ...base, name: "a.c", path: "/c", agent: { tool: "same" } })]),
    ).toThrow(/Two actions are the tool "same"/);
  });

  it("describes the agent fields", () => {
    expect(describeAction(defineAction({ ...base, name: "a.b", path: "/a", destructive: true }))).toMatchObject({ destructive: true });
    expect(describeAction(defineAction({ ...base, name: "a.b", path: "/a" }))).not.toHaveProperty("destructive");
  });
});

describe("image sizes", () => {
  it("reads PNG and JPEG headers", () => {
    const png = Buffer.alloc(24);
    png.writeUInt32BE(0x89504e47, 0);
    png.write("IHDR", 12, "ascii");
    png.writeUInt32BE(1280, 16);
    png.writeUInt32BE(9000, 20);
    expect(imageSize(png)).toEqual({ width: 1280, height: 9000 });
    // SOI, an APP0 segment of 4 bytes, then SOF0 with height 600 and width 800.
    const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x58, 0x03, 0x20, 0x03, 0, 0, 0, 0]);
    expect(imageSize(jpg)).toEqual({ width: 800, height: 600 });
    expect(imageSize(Buffer.from("not an image"))).toBeNull();
  });
});

describe("what people read", () => {
  it("writes options in kebab case, a run of capitals as one word", () => {
    expect(["packId", "baseURL", "pauseOnBroken", "url", "screencastSize", "HTTPProxy"].map(kebab)).toEqual(["pack-id", "base-url", "pause-on-broken", "url", "screencast-size", "http-proxy"]);
  });

  it("shows event times on this machine's clock", () => {
    const at = new Date(2026, 9, 28, 13, 4, 9);
    expect(clock(at.toISOString())).toBe("13:04:09");
  });

  it("says how to install a browser Playwright hasn't downloaded", () => {
    const err = new Error("browserType.launch: Executable doesn't exist at C:\\x\\chrome.exe\n╔═══╗\n║ Looks like Playwright was just installed or updated. Please run: npx playwright install ║");
    expect(missingBrowser("chromium", err)?.message).toBe("Playwright's chromium isn't installed on this machine. Install it with: npx playwright install chromium");
    expect(missingBrowser("chromium", new Error("Target closed"))).toBeNull();
  });
});
