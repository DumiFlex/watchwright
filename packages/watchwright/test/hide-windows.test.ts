import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { hideChildWindows, withWindowsHide } from "../src/cli/hide-windows.js";

describe("withWindowsHide", () => {
  it("adds windowsHide to the options wherever they sit", () => {
    expect(withWindowsHide("spawn", ["ffmpeg", ["-i", "x"], { stdio: "pipe" }])).toEqual(["ffmpeg", ["-i", "x"], { stdio: "pipe", windowsHide: true }]);
    expect(withWindowsHide("spawn", ["ffmpeg", { stdio: "pipe" }])).toEqual(["ffmpeg", { stdio: "pipe", windowsHide: true }]);
    expect(withWindowsHide("spawn", ["ffmpeg"])).toEqual(["ffmpeg", { windowsHide: true }]);
    expect(withWindowsHide("spawn", ["ffmpeg", ["-y"]])).toEqual(["ffmpeg", ["-y"], { windowsHide: true }]);
    expect(withWindowsHide("spawn", ["ffmpeg", undefined, { cwd: "/" }])).toEqual(["ffmpeg", undefined, { cwd: "/", windowsHide: true }]);
  });

  it("puts options before a callback", () => {
    const cb = (): void => undefined;
    expect(withWindowsHide("execFile", ["git", ["status"], cb])).toEqual(["git", ["status"], { windowsHide: true }, cb]);
    expect(withWindowsHide("exec", ["dir", cb])).toEqual(["dir", { windowsHide: true }, cb]);
    expect(withWindowsHide("exec", ["dir", { cwd: "/" }, cb])).toEqual(["dir", { cwd: "/", windowsHide: true }, cb]);
    expect(withWindowsHide("exec", ["dir", undefined, cb])).toEqual(["dir", { windowsHide: true }, cb]);
  });

  it("keeps an explicit windowsHide: false", () => {
    expect(withWindowsHide("spawn", ["cmd", [], { windowsHide: false }])).toEqual(["cmd", [], { windowsHide: false }]);
  });

  it("doesn't change the caller's options object", () => {
    const opts = { stdio: "pipe" };
    withWindowsHide("spawn", ["ffmpeg", [], opts]);
    expect(opts).toEqual({ stdio: "pipe" });
  });
});

describe("hideChildWindows", () => {
  function fakeModule() {
    const calls: unknown[][] = [];
    const record = (...args: unknown[]): unknown[] => (calls.push(args), args);
    const exec = Object.assign(record.bind(null), { [promisify.custom]: record.bind(null) });
    return { calls, cp: { spawn: record.bind(null), spawnSync: record.bind(null), execFile: record.bind(null), execFileSync: record.bind(null), exec, execSync: record.bind(null), fork: record.bind(null) } };
  }

  it("does nothing off Windows", () => {
    const { cp, calls } = fakeModule();
    expect(hideChildWindows("linux", cp)).toBe(false);
    cp.spawn("ffmpeg", []);
    expect(calls).toEqual([["ffmpeg", []]]);
  });

  it("hides every child's window on Windows, once", () => {
    const { cp, calls } = fakeModule();
    expect(hideChildWindows("win32", cp)).toBe(true);
    expect(hideChildWindows("win32", cp)).toBe(true);
    cp.spawn("ffmpeg", ["-y"], { stdio: "pipe" });
    cp.fork("child.js");
    (cp.exec as unknown as Record<symbol, (...a: unknown[]) => unknown>)[promisify.custom]?.("dir");
    expect(calls).toEqual([
      ["ffmpeg", ["-y"], { stdio: "pipe", windowsHide: true }],
      ["child.js", { windowsHide: true }],
      ["dir", { windowsHide: true }],
    ]);
  });
});
