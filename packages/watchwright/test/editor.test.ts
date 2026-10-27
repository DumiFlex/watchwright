import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listFiles, resolveIn, savePackFile, stampOf } from "../src/plugins/editor/files.js";
import { cleanTempDirs, tempDir, writeFiles } from "./helpers/fixtures.js";
import { startHarness, type Harness } from "./helpers/harness.js";

const PACK = {
  "pack.yaml": "name: Edit me\nsite: { key: edit-me, baseURL: http://127.0.0.1:9/ }\n",
  "tests/home.yaml": "id: H1\ntitle: Home\nsteps:\n  - goto: /\n",
  "README.md": "# Edit me\n",
  "shot.png": "\u0089PNG\r\n\u001a\n\u0000\u0000",
  "node_modules/x/index.js": "export {};\n",
  ".git/HEAD": "ref: refs/heads/main\n",
};

afterEach(() => cleanTempDirs());

describe("pack files", () => {
  it("lists text files, folders first, leaving out packages, version control and binaries", () => {
    const dir = tempDir("ww-pack-");
    writeFiles(dir, PACK);
    writeFileSync(path.join(dir, "big.txt"), "x".repeat(1024 * 1024 + 1));
    expect(listFiles(dir).files.map((f) => [f.path, f.kind, f.big])).toEqual([
      ["tests/home.yaml", "yaml", false],
      ["big.txt", "text", true],
      ["pack.yaml", "yaml", false],
      ["README.md", "markdown", false],
    ]);
  });

  it("keeps every path inside the pack folder", () => {
    const dir = tempDir("ww-pack-");
    const outside = tempDir("ww-out-");
    writeFiles(dir, PACK);
    writeFileSync(path.join(outside, "secret.txt"), "no");
    symlinkSync(path.join(outside, "secret.txt"), path.join(dir, "link.txt"));
    symlinkSync(outside, path.join(dir, "linked"));
    expect(resolveIn(dir, "tests/home.yaml")).toBe(path.join(dir, "tests", "home.yaml"));
    expect(resolveIn(dir, "tests/new/deep.yaml")).toBe(path.join(dir, "tests", "new", "deep.yaml"));
    for (const bad of ["../x.txt", "/etc/passwd", "C:/x.txt", "tests/../../x.txt", "link.txt", "linked/secret.txt", "linked/new.txt", "node_modules/x/index.js", ".git/HEAD", "", "."])
      expect(() => resolveIn(dir, bad), bad).toThrow();
  });

  it("refuses a save over a file that changed since it was read", () => {
    const dir = tempDir("ww-pack-");
    writeFiles(dir, PACK);
    const first = stampOf(readFileSync(path.join(dir, "README.md")));
    const saved = savePackFile(dir, "README.md", "# One\n", first);
    expect(saved.stamp).toBe(stampOf("# One\n"));
    expect(() => savePackFile(dir, "README.md", "# Two\n", first)).toThrow(/changed on disk/);
    expect(readFileSync(path.join(dir, "README.md"), "utf8")).toBe("# One\n");
    savePackFile(dir, "README.md", "# Two\n", null); // overwrite on purpose
    expect(readFileSync(path.join(dir, "README.md"), "utf8")).toBe("# Two\n");
  });
});

describe("the editor's actions", () => {
  let h: Harness;
  let dir: string;
  let id: string;

  async function setup() {
    dir = tempDir("ww-pack-");
    writeFiles(dir, PACK);
    h = await startHarness(tempDir("ww-data-"));
    const added = await h.api<{ id: string; status: string }>("POST", "/packs", { path: dir });
    expect(added.data.status).toBe("ok");
    id = added.data.id;
  }

  it("read, save with the stamp, and rebuild the pack", async () => {
    await setup();
    try {
      const list = await h.api<{ files: { path: string }[] }>("GET", `/packs/${id}/files`);
      expect(list.data.files.map((f) => f.path)).toContain("tests/home.yaml");
      const file = await h.api<{ text: string; stamp: string; kind: string }>("GET", `/packs/${id}/file?path=tests/home.yaml`);
      expect(file.data.kind).toBe("yaml");
      expect(file.data.text).toContain("id: H1");

      // A typo: saved, and the answer says the pack no longer loads, with the problem's line.
      const bad = await h.api<{ file: { stamp: string }; pack: { status: string; problems: string[] } }>("POST", `/packs/${id}/file`, { path: "tests/home.yaml", text: file.data.text.replace("goto", "gotoo"), stamp: file.data.stamp });
      expect(bad.status).toBe(200);
      expect(bad.data.pack.status).toBe("error");
      expect(bad.data.pack.problems).toEqual([`tests/home.yaml:4:5 "gotoo" isn't a step. Did you mean "goto"?`]);

      // Someone else changed the file: the stale stamp is refused, with what is there now.
      writeFileSync(path.join(dir, "tests/home.yaml"), file.data.text.replace("Home", "Start"));
      const stale = await h.api("POST", `/packs/${id}/file`, { path: "tests/home.yaml", text: file.data.text, stamp: bad.data.file.stamp });
      expect(stale.status).toBe(409);
      expect(stale.error?.code).toBe("stale");
      expect((stale.error?.detail as { text: string }).text).toContain("title: Start");

      const fixed = await h.api<{ pack: { status: string } }>("POST", `/packs/${id}/file`, { path: "tests/home.yaml", text: file.data.text });
      expect(fixed.data.pack.status).toBe("ok");
      const changed = await h.waitFor((e) => e.type === "editor.file_changed");
      expect(changed.data).toMatchObject({ packId: id, action: "save", path: "tests/home.yaml" });
    } finally {
      await h.close();
    }
  });

  it("create, rename and delete files", async () => {
    await setup();
    try {
      const made = await h.api<{ pack: { status: string } }>("POST", `/packs/${id}/files`, { path: "tests/more/second.yaml", text: "id: H2\nsteps: [reload]\n" });
      expect(made.status).toBe(201);
      expect((await h.api<{ tests: { id: string }[] }>("GET", `/packs/${id}`)).data.tests.map((t) => t.id)).toEqual(["H1", "H2"]);
      expect((await h.api("POST", `/packs/${id}/files`, { path: "tests/more/second.yaml", text: "" })).error?.code).toBe("exists");
      expect((await h.api("POST", `/packs/${id}/files`, { path: "tests/run.exe", text: "" })).error?.code).toBe("not_text");
      expect((await h.api("POST", `/packs/${id}/files`, { path: "../escape.yaml", text: "" })).error?.code).toBe("bad_path");

      const moved = await h.api<{ to: string }>("POST", `/packs/${id}/file/rename`, { from: "tests/more/second.yaml", to: "tests/second.yaml" });
      expect(moved.data.to).toBe("tests/second.yaml");
      expect(existsSync(path.join(dir, "tests/second.yaml"))).toBe(true);
      expect((await h.api("POST", `/packs/${id}/file/rename`, { from: "tests/second.yaml", to: "tests/home.yaml" })).error?.code).toBe("exists");

      const gone = await h.api<{ deleted: string }>("DELETE", `/packs/${id}/file?path=tests/second.yaml`);
      expect(gone.data.deleted).toBe("tests/second.yaml");
      expect((await h.api<{ tests: { id: string }[] }>("GET", `/packs/${id}`)).data.tests.map((t) => t.id)).toEqual(["H1"]);
      expect((await h.api("DELETE", `/packs/${id}/file?path=tests/second.yaml`)).status).toBe(404);
    } finally {
      await h.close();
    }
  });

  it("won't open binary or big files", async () => {
    await setup();
    try {
      expect((await h.api("GET", `/packs/${id}/file?path=shot.png`)).error?.code).toBe("not_text");
      mkdirSync(path.join(dir, "data"));
      writeFileSync(path.join(dir, "data/big.txt"), "x".repeat(1024 * 1024 + 1));
      expect((await h.api("GET", `/packs/${id}/file?path=data/big.txt`)).status).toBe(413);
      expect((await h.api("GET", `/packs/${id}/file?path=missing.yaml`)).status).toBe(404);
    } finally {
      await h.close();
    }
  });

  it("checks YAML text without saving it", async () => {
    await setup();
    try {
      const test = await h.api<{ problems: { line: number; col: number; message: string; from: number; to: number }[]; tests: unknown[] }>("POST", "/packs/check-yaml", { text: "id: T\nsteps:\n  - clik: a\n" });
      expect(test.data.problems).toEqual([{ line: 3, col: 5, message: `"clik" isn't a step. Did you mean "click"?`, from: 17, to: 21 }]);
      const pack = await h.api<{ problems: { message: string }[] }>("POST", "/packs/check-yaml", { kind: "pack", text: "name: P\nsite: { key: p }\nbrowser: { name: safari }\n" });
      expect(pack.data.problems.map((p) => p.message)).toEqual(["pack.browser.name is one of chromium, firefox, webkit."]);
    } finally {
      await h.close();
    }
  });
});
