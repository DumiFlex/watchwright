import { describe, expect, it } from "vitest";
import { isCodeFile } from "../src/codefiles";

// Mirrors the server's list in packages/watchwright/test/code-access.test.ts.
describe("code files", () => {
  it("tells code and build files from YAML and data", () => {
    for (const f of ["pack.ts", "tests/a.mts", "lib/x.cjs", "a.jsx", "helpers.js", "package.json", "tsconfig.json", "tsconfig.build.json", "jsconfig.json", ".npmrc", "pnpm-lock.yaml", "sub\\package-lock.json"]) expect(isCodeFile(f), f).toBe(true);
    for (const f of ["pack.yaml", "tests/home.yaml", "data/users.json", "README.md", "notes.txt", "rubric.yml", "list.csv"]) expect(isCodeFile(f), f).toBe(false);
  });
});
