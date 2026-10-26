import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveDataDir } from "../src/config.js";

describe("resolveDataDir", () => {
  it("prefers --data over everything", () => {
    expect(resolveDataDir({ flag: "some/dir", env: { WATCHWRIGHT_DATA: "/env" } })).toBe(path.resolve("some/dir"));
  });

  it("uses WATCHWRIGHT_DATA next", () => {
    expect(resolveDataDir({ env: { WATCHWRIGHT_DATA: "/from-env" }, platform: "linux", home: "/home/a" })).toBe(path.resolve("/from-env"));
  });

  it("uses LOCALAPPDATA on Windows", () => {
    expect(resolveDataDir({ env: { LOCALAPPDATA: "C:\\Users\\a\\AppData\\Local" }, platform: "win32", home: "C:\\Users\\a" })).toBe(
      "C:\\Users\\a\\AppData\\Local\\Watchwright",
    );
  });

  it("falls back to the home folder on Windows without LOCALAPPDATA", () => {
    expect(resolveDataDir({ env: {}, platform: "win32", home: "C:\\Users\\a" })).toBe("C:\\Users\\a\\AppData\\Local\\Watchwright");
  });

  it("uses Application Support on macOS", () => {
    expect(resolveDataDir({ env: {}, platform: "darwin", home: "/Users/a" })).toBe("/Users/a/Library/Application Support/Watchwright");
  });

  it("follows XDG_DATA_HOME on Linux, else ~/.local/share", () => {
    expect(resolveDataDir({ env: { XDG_DATA_HOME: "/xdg" }, platform: "linux", home: "/home/a" })).toBe("/xdg/watchwright");
    expect(resolveDataDir({ env: {}, platform: "linux", home: "/home/a" })).toBe("/home/a/.local/share/watchwright");
  });
});
