import { spawn } from "node:child_process";
import { cpSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium } from "playwright";
import { resolveDataDir } from "../config.js";
import { serveCommand, type AfterStart } from "./serve.js";

// `watchwright demo`: a first run in one command. It gets Chromium when Playwright has none,
// copies the TodoMVC example pack into the data folder, starts the server (or uses the one
// that runs), adds the pack, starts a run of it and opens that run's page.

/** The TodoMVC pack: next to the built CLI (dist/demo, copied by the build), else the repository's example. */
export function demoSource(): string | null {
  const candidates = [new URL("../demo/todomvc/", import.meta.url), new URL("../../../../examples/todomvc/", import.meta.url)];
  for (const c of candidates) {
    const dir = fileURLToPath(c);
    if (existsSync(path.join(dir, "pack.yaml"))) return dir;
  }
  return null;
}

/**
 * Copies the demo pack to `<data>/demo/todomvc` the first time. Later demos keep that copy, so
 * changes made to it in the editor stay; delete the folder to get the original back.
 */
export function placeDemoPack(source: string, dataDir: string): string {
  const dir = path.join(dataDir, "demo", "todomvc");
  if (!existsSync(path.join(dir, "pack.yaml"))) cpSync(source, dir, { recursive: true });
  return dir;
}

/** After the server answers: starts a run of the demo pack and gives its page. */
export const startDemoRun: AfterStart = async (api, packs) => {
  const pack = packs[0]?.data;
  if (!pack || pack.status !== "ok") return null;
  const res = await api("POST", "/runs", { packId: pack.id, label: "Demo" });
  const id = res.data?.id;
  if (typeof id !== "string") {
    console.error(`Couldn't start the demo run: ${res.error?.message ?? "no answer"}`);
    return `#/packs/${pack.id}`;
  }
  console.log(`Started a run of "${pack.name}".`);
  return `#/runs/${id}`;
};

/** Downloads Playwright's Chromium when it isn't there yet. Resolves to false when that failed. */
async function ensureChromium(): Promise<boolean> {
  if (existsSync(chromium.executablePath())) return true;
  console.log("Playwright has no Chromium yet. Downloading it once (about 150 MB)…");
  const cli = path.join(path.dirname(createRequire(import.meta.url).resolve("playwright/package.json")), "cli.js");
  const code = await new Promise<number>((resolve) => {
    const child = spawn(process.execPath, [cli, "install", "chromium"], { stdio: "inherit" });
    child.on("error", () => resolve(1));
    child.on("exit", (c) => resolve(c ?? 1));
  });
  if (code !== 0) console.error("Couldn't download Chromium. Run `npx playwright install chromium`, then `watchwright demo` again.");
  return code === 0;
}

export async function demoCommand(argv: string[]): Promise<number> {
  // The same options as serve, and no pack folders: the demo brings its own.
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { port: { type: "string" }, host: { type: "string" }, data: { type: "string" }, "no-open": { type: "boolean" } },
  });
  if (positionals.length) {
    console.error("watchwright demo takes no pack folders. To open your own packs, use `watchwright serve <folder>`.");
    return 2;
  }
  const source = demoSource();
  if (!source) {
    console.error("The demo pack is missing from this install of Watchwright.");
    return 1;
  }
  if (!(await ensureChromium())) return 1;
  const dir = placeDemoPack(source, resolveDataDir({ flag: values.data }));
  console.log(`Demo pack: ${dir}`);
  return serveCommand([...argv, dir], startDemoRun);
}
