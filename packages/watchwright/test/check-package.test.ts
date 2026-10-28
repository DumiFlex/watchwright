import { describe, expect, it } from "vitest";
import { checkPackage, MAX_UNPACKED_BYTES, REQUIRED } from "../scripts/check-package.js";

const good = REQUIRED.map((path) => ({ path, size: 100 }));

describe("checkPackage", () => {
  it("passes a package with every required file", () => {
    expect(checkPackage(good)).toEqual([]);
  });

  it("names missing files", () => {
    expect(checkPackage(good.filter((f) => f.path !== "LICENSE"))).toEqual(["missing LICENSE"]);
  });

  it("rejects sources, tests, local data and secrets", () => {
    const extra = ["src/index.ts", "test/x.test.ts", ".watchwright/store.sqlite", "dist/.env", ".npmrc", "dist/web/backup.zip"];
    const problems = checkPackage([...good, ...extra.map((path) => ({ path, size: 1 }))]);
    expect(problems).toHaveLength(extra.length);
    for (const path of extra) expect(problems.some((p) => p.startsWith(path))).toBe(true);
  });

  it("keeps maps, schemas and the web app", () => {
    const fine = ["dist/cli/main.js.map", "dist/web/assets/index-abc.js", "dist/web/kit/sample.webm"];
    expect(checkPackage([...good, ...fine.map((path) => ({ path, size: 1 }))])).toEqual([]);
  });

  it("flags an oversized package", () => {
    expect(checkPackage([...good, { path: "dist/web/assets/huge.js", size: MAX_UNPACKED_BYTES }])[0]).toMatch(/unpacked size/);
  });
});
