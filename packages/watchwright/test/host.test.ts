import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { folderRoots, hasDesktop } from "../src/host.js";
import { FOLDERS_MIGRATION_SQL, FolderError, FolderService } from "../src/plugins/folders/folders.js";
import { cleanTempDirs, tempDir } from "./helpers/fixtures.js";

// Server mode (docs/plans/self-hosting.md, section 5): no desktop in a container, and the folder
// browser kept inside the folders the server allows.

afterEach(() => cleanTempDirs());

describe("hasDesktop", () => {
  it("knows a desktop by the platform or a display, and WATCHWRIGHT_SERVER_HOST turns it off", () => {
    expect(hasDesktop({}, "win32")).toBe(true);
    expect(hasDesktop({}, "darwin")).toBe(true);
    expect(hasDesktop({}, "linux")).toBe(false);
    expect(hasDesktop({ WAYLAND_DISPLAY: "wayland-0" }, "linux")).toBe(true);
    expect(hasDesktop({ DISPLAY: ":0", WATCHWRIGHT_SERVER_HOST: "1" }, "linux")).toBe(false);
    expect(hasDesktop({ WATCHWRIGHT_SERVER_HOST: "on" }, "win32")).toBe(false);
    expect(hasDesktop({ WATCHWRIGHT_SERVER_HOST: "0" }, "linux")).toBe(true);
  });
});

describe("folderRoots", () => {
  it("reads absolute folders from WATCHWRIGHT_FOLDERS", () => {
    expect(folderRoots({}, "linux")).toBeNull();
    expect(folderRoots({ WATCHWRIGHT_FOLDERS: "/packs" }, "linux")).toEqual(["/packs"]);
    expect(folderRoots({ WATCHWRIGHT_FOLDERS: "/packs/, /srv/tests:relative" }, "linux")).toEqual(["/packs", "/srv/tests"]);
    expect(folderRoots({ WATCHWRIGHT_FOLDERS: "D:\\packs;E:\\more" }, "win32")).toEqual(["D:\\packs", "E:\\more"]);
    expect(folderRoots({ WATCHWRIGHT_FOLDERS: "relative" }, "linux")).toBeNull();
  });
});

describe("folders on a server", () => {
  const service = (opts: ConstructorParameters<typeof FolderService>[1]) => {
    const db = new Database(":memory:");
    db.exec(FOLDERS_MIGRATION_SQL);
    return new FolderService(db, opts);
  };

  it("browses only inside the allowed folders and starts there", () => {
    const root = tempDir("ww-roots-");
    mkdirSync(path.join(root, "packs", "shop"), { recursive: true });
    mkdirSync(path.join(root, "secret"), { recursive: true });
    const packs = path.join(root, "packs");
    const f = service({ roots: [packs] });
    expect(f.places()).toMatchObject({ start: packs, roots: [packs] });
    const top = f.list(packs);
    expect(top.parent).toBeNull();
    expect(top.folders.map((x) => x.name)).toEqual(["shop"]);
    expect(f.list(path.join(packs, "shop")).parent).toBe(packs);
    expect(() => f.list(path.join(root, "secret"))).toThrow(FolderError);
    expect(() => f.list(path.join(packs, "..", "secret"))).toThrow(/only shows folders inside/);
  });

  it("refuses to open a folder without a desktop", () => {
    const root = tempDir("ww-roots-");
    const f = service({ desktop: false, dataDir: root });
    expect(f.canOpen).toBe(false);
    expect(() => f.open(root, () => undefined)).toThrow(/no screen/);
  });
});
