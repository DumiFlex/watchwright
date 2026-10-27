import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

// Shared test fixtures: temp folders, a tiny site to test against, and pack folders written from strings.

const dirs: string[] = [];

export function tempDir(prefix = "ww-test-"): string {
  const d = mkdtempSync(path.join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}

export function cleanTempDirs(): void {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
}

/** Writes files (relative path → content) under `root`. */
export function writeFiles(root: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, ...rel.split("/"));
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
}

/** A small site: a home page with a counter button, a slow page, a page that logs a console error. */
export async function startSite(): Promise<{ url: string; close(): Promise<void> }> {
  const pages: Record<string, string> = {
    "/": `<!doctype html><title>Fixture home</title><h1>Fixture home</h1>
      <button id="inc" onclick="document.getElementById('n').textContent = String(Number(document.getElementById('n').textContent) + 1)">Add one</button>
      <p>Count: <span id="n">0</span></p><a id="other" href="/other">Other page</a>
      <a id="popup" href="/other" target="_blank">Open in a new tab</a>
      <div style="height: 2400px">tall</div>`,
    "/other": `<!doctype html><title>Other</title><h1>Other page</h1><p id="msg">Hello from the other page</p>`,
    "/noisy": `<!doctype html><title>Noisy</title><h1>Noisy</h1><script>console.error("fixture console error"); fetch("/missing")</script>`,
  };
  const server: Server = createServer((req, res) => {
    const url = (req.url ?? "/").split("?")[0]!;
    const page = pages[url];
    if (!page) {
      res.writeHead(404, { "content-type": "text/plain" }).end("missing");
      return;
    }
    res.writeHead(200, { "content-type": "text/html" }).end(page);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no address");
  return {
    url: `http://127.0.0.1:${addr.port}/`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
