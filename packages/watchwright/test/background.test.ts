import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { backgroundArgs, serverLogFile, startInBackground } from "../src/cli/background.js";
import { tempDir } from "./helpers/fixtures.js";
import { freePort } from "./helpers/harness.js";

describe("serve --background", () => {
  it("passes serve's options on without --background and never opens a browser", () => {
    expect(backgroundArgs(["--port", "7500", "--background", "packs/a"])).toEqual(["--port", "7500", "packs/a", "--no-open"]);
    expect(backgroundArgs(["--background", "--no-open"])).toEqual(["--no-open"]);
  });

  it("starts the server as its own process, logs its output and returns once it answers", async () => {
    const dir = tempDir("ww-bg-");
    const port = await freePort();
    // Stands in for the CLI: answers on the port and writes a line, like `serve` does.
    const main = path.join(dir, "fake-serve.mjs");
    writeFileSync(
      main,
      `import http from "node:http";
console.log("args " + process.argv.slice(2).join(" "));
http.createServer((q, s) => s.end("ok")).listen(${port}, "127.0.0.1");`,
    );
    const up = () =>
      fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(500) })
        .then(() => "1.2.3")
        .catch(() => null);
    const started = await startInBackground({ argv: ["--port", String(port), "--background"], url: "", dataDir: dir, up, node: process.execPath, main });
    try {
      expect(started).toMatchObject({ ok: true, version: "1.2.3", log: serverLogFile(dir) });
      for (let i = 0; i < 50 && !readFileSync(serverLogFile(dir), "utf8").includes("args"); i++) await new Promise((r) => setTimeout(r, 20));
      expect(readFileSync(serverLogFile(dir), "utf8")).toContain(`args serve --port ${port} --no-open`);
    } finally {
      if (started.ok) process.kill(started.pid);
    }
  });

  it("says why when the server exits instead of answering", async () => {
    const dir = tempDir("ww-bg-");
    const main = path.join(dir, "fail.mjs");
    writeFileSync(main, `console.error("Port 1 is taken by another program."); process.exit(1);`);
    const started = await startInBackground({ argv: [], url: "", dataDir: dir, up: async () => null, node: process.execPath, main, waitMs: 10_000 });
    expect(started.ok).toBe(false);
    if (!started.ok) expect(started.output).toContain("Port 1 is taken");
  });
});
