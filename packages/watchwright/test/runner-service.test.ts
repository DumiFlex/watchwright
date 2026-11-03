import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanUpRemoved, readRunnerConfig, runnerCommand, runnerConfigPath } from "../src/cli/runner.js";
import { installService, LABEL, serverOf, serviceContent, serviceFile, serviceKind, serviceState, uninstallService, UNIT, type Host } from "../src/cli/runner-service.js";
import { writePrivateJson } from "../src/cli/credentials.js";
import { cleanTempDirs, tempDir } from "./helpers/fixtures.js";

// A runner that starts by itself (docs/research/runner-service.md): the start-up entry per system,
// installing and removing it, and the runner removing itself after the server removed it.

afterEach(() => cleanTempDirs());

const SERVER = "https://ww.example.com";

function fakeHost(platform: NodeJS.Platform, o: Partial<Host> = {}): Host & { calls: string[] } {
  const home = tempDir("ww-home-");
  const calls: string[] = [];
  return {
    platform,
    env: { WATCHWRIGHT_CONFIG_DIR: path.join(home, "cfg"), APPDATA: path.join(home, "AppData"), USER: "sam" },
    home,
    uid: 1000,
    node: "/opt/node/bin/node",
    script: "/opt/ww/dist/cli/main.js",
    kind: "npm",
    run(cmd, args) {
      calls.push([cmd, ...args].join(" "));
      return { status: 0, out: "" };
    },
    exists: (f) => f === "/run/systemd/system" || existsSync(f),
    ...o,
    calls,
  };
}

const quiet = { info: () => undefined, warn: () => undefined };

function pairHere(h: Host, server = SERVER) {
  writePrivateJson(runnerConfigPath(h.env), { servers: { [server]: { id: "abcd1234", name: "Desk", token: "wwr_x", allow: ["loopback"], savedAt: "2026-11-02T00:00:00Z" } }, last: server });
}

describe("start-up entries", () => {
  it("picks one per system", () => {
    expect(serviceKind(fakeHost("win32"))).toBe("windows");
    expect(serviceKind(fakeHost("darwin"))).toBe("launchd");
    expect(serviceKind(fakeHost("linux"))).toBe("systemd");
    // systemctl answering isn't enough: systemd has to be running.
    expect(serviceKind(fakeHost("linux", { exists: () => false }))).toBeNull();
    expect(serviceFile(fakeHost("linux", { uid: 0 }), "systemd")).toBe(`/etc/systemd/system/${UNIT}`);
  });

  it("writes a Windows .cmd that starts the runner with no window", () => {
    const h = fakeHost("win32", { node: "C:\\Program Files\\nodejs\\node.exe", script: "C:\\Users\\sam\\AppData\\Roaming\\npm\\node_modules\\watchwright\\dist\\cli\\main.js" });
    const cmd = serviceContent(h, "windows", SERVER);
    expect(cmd).toContain('start "Watchwright runner" /min "C:\\Program Files\\nodejs\\node.exe" C:\\Users');
    expect(cmd).toContain(`runner start --server ${SERVER}`);
    expect(cmd).toContain("set \"WATCHWRIGHT_CONFIG_DIR=");
    expect(cmd.split("\r\n")[0]).toBe("@echo off");
    expect(serverOf(cmd)).toBe(SERVER);
  });

  it("writes a systemd unit that stays stopped after it removed itself", () => {
    const user = serviceContent(fakeHost("linux"), "systemd", SERVER);
    expect(user).toContain(`ExecStart=/opt/node/bin/node /opt/ww/dist/cli/main.js runner --server ${SERVER}`);
    expect(user).toContain("Environment=PATH=/opt/node/bin:/usr/local/bin:/usr/bin:/bin");
    expect(user).toContain("Environment=WATCHWRIGHT_RUNNER_SERVICE=systemd");
    expect(user).toContain("Restart=on-failure");
    expect(user).toContain("WantedBy=default.target");
    expect(serverOf(user)).toBe(SERVER);
    const root = serviceContent(fakeHost("linux", { uid: 0 }), "systemd", SERVER);
    expect(root).toContain("WantedBy=multi-user.target");
    expect(root).toContain("After=network-online.target");
  });

  it("runs npx with the same version when started from npx's cache", () => {
    const unit = serviceContent(fakeHost("linux", { kind: "npx", exists: () => false }), "systemd", SERVER);
    expect(unit).toMatch(new RegExp(`ExecStart=npx --yes watchwright@\\S+ runner --server ${SERVER.replace(/\./g, "\\.")}`));
  });

  it("writes a LaunchAgent on macOS", () => {
    const plist = serviceContent(fakeHost("darwin"), "launchd", SERVER);
    expect(plist).toContain(`<key>Label</key><string>${LABEL}</string>`);
    expect(plist).toContain("<key>SuccessfulExit</key><false/>");
    expect(plist).toContain("<key>WATCHWRIGHT_RUNNER_SERVICE</key><string>launchd</string>");
    expect(serverOf(plist)).toBe(SERVER);
  });

  it("installs and removes a systemd unit", async () => {
    const h = fakeHost("linux");
    const lines = await installService(h, SERVER);
    const file = serviceFile(h, "systemd");
    expect(readFileSync(file, "utf8")).toContain("runner --server");
    expect(h.calls).toEqual(["systemctl --user daemon-reload", `systemctl --user enable --now ${UNIT}`, "loginctl enable-linger sam"]);
    expect(lines.join("\n")).toMatch(/starts again at sign-in/);
    expect(serviceState(h)).toMatchObject({ kind: "systemd", installed: true, server: SERVER, running: true });

    h.calls.length = 0;
    await uninstallService(h);
    expect(existsSync(file)).toBe(false);
    expect(h.calls).toEqual([`systemctl --user disable --now ${UNIT}`, "systemctl --user daemon-reload"]);
  });

  it("says what to run when it can't turn on lingering", async () => {
    const h = fakeHost("linux", { run: (cmd) => ({ status: cmd === "loginctl" ? 1 : 0, out: "" }) });
    expect((await installService(h, SERVER)).join("\n")).toContain("sudo loginctl enable-linger sam");
  });

  it("removes the unit again when systemd won't start it", async () => {
    const h = fakeHost("linux", { run: (cmd, args) => ({ status: args.includes("enable") ? 1 : 0, out: "Failed to connect to bus" }) });
    await expect(installService(h, SERVER)).rejects.toThrow(/Failed to connect to bus/);
    expect(existsSync(serviceFile(h, "systemd"))).toBe(false);
  });

  it("refuses where there is no systemd, and points at runner start", async () => {
    const h = fakeHost("linux", { exists: () => false, run: () => ({ status: null, out: "" }) });
    await expect(installService(h, SERVER)).rejects.toThrow(/watchwright runner start/);
  });
});

describe("removed on the server", () => {
  it("forgets the token and removes the start-up entry for that server", async () => {
    const h = fakeHost("linux");
    pairHere(h);
    await installService(h, SERVER);
    h.calls.length = 0;
    expect(await cleanUpRemoved(h, SERVER, quiet)).toBe(true);
    expect(readRunnerConfig(h.env)).toEqual({ servers: {} });
    expect(existsSync(serviceFile(h, "systemd"))).toBe(false);
    // From inside the unit it doesn't stop itself through systemctl (that would wait on this very process).
    expect(h.calls.filter((c) => !c.includes("is-active"))).toEqual([`systemctl --user disable ${UNIT}`, "systemctl --user daemon-reload"]);
  });

  it("leaves an entry for another server alone", async () => {
    const h = fakeHost("linux");
    pairHere(h, "https://other.example.com");
    await installService(h, SERVER);
    expect(await cleanUpRemoved(h, "https://other.example.com", quiet)).toBe(false);
    expect(existsSync(serviceFile(h, "systemd"))).toBe(true);
  });
});

describe("watchwright runner status and uninstall", () => {
  it("reports and removes, and --forget deletes the tokens", async () => {
    const h = fakeHost("win32");
    pairHere(h);
    const file = serviceFile(h, "windows");
    writeFileSync(path.join(h.home, "x"), "");
    const lines: string[] = [];
    const log = { info: (l: string) => lines.push(l), warn: (l: string) => lines.push(l) };
    await runnerCommand(["status"], h.env, log, h);
    expect(lines.join("\n")).toMatch(/Paired with https:\/\/ww\.example\.com as Desk[\s\S]*No start-up entry[\s\S]*No runner runs in the background now/);

    lines.length = 0;
    const { mkdirSync } = await import("node:fs");
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, serviceContent(h, "windows", SERVER));
    await runnerCommand(["status"], h.env, log, h);
    expect(lines.join("\n")).toContain(`Starts by itself at sign-in, for ${SERVER}`);

    lines.length = 0;
    expect(await runnerCommand(["uninstall", "--forget"], h.env, log, h)).toBe(0);
    expect(existsSync(file)).toBe(false);
    expect(readRunnerConfig(h.env).servers).toEqual({});
    expect(lines.join("\n")).toMatch(/Removed .*Watchwright runner\.cmd[\s\S]*Forgot the tokens for https:\/\/ww\.example\.com/);
  });

  it("refuses an unknown subcommand", async () => {
    await expect(runnerCommand(["restart"], { WATCHWRIGHT_CONFIG_DIR: tempDir("ww-cfg-") }, quiet, fakeHost("linux"))).rejects.toThrow(/one of install, uninstall/);
  });
});
