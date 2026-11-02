import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// `watchwright mcp` (held open by Claude Desktop) and `watchwright update` must not load the
// server's code: on Windows a loaded native module (better-sqlite3) locks its file, and npm couldn't
// replace the package. This follows their static imports (type-only ones are erased) and lists the
// packages they reach.

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const IMPORT = /^\s*(?:import(?!\s+type\b)|export(?!\s+type\b))\s[^;]*?from\s+"([^"]+)"|^\s*import\s+"([^"]+)"/gms;

function reach(entry: string): { files: string[]; packages: string[] } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const walk = (file: string) => {
    if (files.has(file)) return;
    files.add(file);
    for (const m of readFileSync(file, "utf8").matchAll(IMPORT)) {
      const spec = m[1] ?? m[2];
      if (!spec || spec.startsWith("node:")) continue;
      if (spec.startsWith(".")) walk(path.resolve(path.dirname(file), spec.replace(/\.js$/, ".ts")));
      else packages.add(spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]!);
    }
  };
  walk(path.join(SRC, entry));
  return { files: [...files].map((f) => path.relative(SRC, f).replace(/\\/g, "/")), packages: [...packages].sort() };
}

describe("what the light commands load", () => {
  it("the command's entry loads no package; the heavy commands load when they run", () => {
    expect(reach("cli/main.ts").packages).toEqual([]);
  });

  it("the MCP bridge and the update command load only the MCP SDK", () => {
    for (const entry of ["cli/mcp.ts", "cli/update.ts", "cli/runner.ts"]) {
      const { files, packages } = reach(entry);
      expect(packages.filter((p) => p !== "@modelcontextprotocol/server"), entry).toEqual([]);
      expect(files.filter((f) => f.startsWith("store/") || f.startsWith("server/app") || f === "cli/serve.ts"), entry).toEqual([]);
    }
  });
});
