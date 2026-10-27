// Seeds a data folder with a fixture pack and fake runs, starts the built server, and prints its port.
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import Database from "better-sqlite3";

const root = "/tmp/claude-0/shots/work";
rmSync(root, { recursive: true, force: true });
const data = path.join(root, "data"), packDir = path.join(root, "shop");
mkdirSync(path.join(packDir, "tests"), { recursive: true });
writeFileSync(path.join(packDir, "pack.ts"), `
import { pack } from "watchwright";
export default pack({
  name: "Shop smoke",
  description: "Checks the storefront: home, search, cart and checkout.",
  site: { key: "shop", baseURL: "http://127.0.0.1:3000/" },
  browser: { name: "firefox", viewport: { width: 1280, height: 800 } },
  params: { model: { choices: ["q9", "haiku", "sonnet"], default: "q9", description: "AI model the shop's assistant uses" }, lang: { choices: ["en", "de"], default: "en" }, slowMo: { type: "number", default: 0, description: "Delay between actions, ms" } },
  flags: { "no-card": "robot", "slow-answer": "finding", "retry-used": "info" },
  tests: "./tests/**/*.ts",
});`);
writeFileSync(path.join(packDir, "tests", "home.ts"), `
import { test } from "watchwright";
test("H1", { title: "Home loads", section: "Home", tags: ["smoke"] }, async () => {});
test("H2", { title: "Search finds boots", section: "Home", tags: ["smoke", "search"], needs: ["H1"] }, async () => {});
test("C1", { title: "Add to cart", section: "Cart", runs: 3, needs: ["H1"] }, async () => {});
test("C2", { title: "Cart totals", section: "Cart", inside: "C1" }, async () => {});
test("K1", { title: "Checkout as guest", section: "Checkout", tags: ["payment"], needs: ["C1"] }, async () => {});
`);
const port = 7400 + Math.floor(Math.random() * 300);
const srv = spawn("node", ["/home/user/watchwright/packages/watchwright/dist/cli/main.js", "serve", "--port", String(port), "--data", data, "--no-open"], { stdio: "ignore", detached: true });
srv.unref();
const base = `http://127.0.0.1:${port}/api/v1`;
for (let i = 0; i < 50; i++) { try { await fetch(base + "/health"); break; } catch { await new Promise((r) => setTimeout(r, 200)); } }
const add = await (await fetch(base + "/packs", { method: "POST", headers: { "content-type": "application/json", "x-watchwright-client": "web" }, body: JSON.stringify({ path: packDir }) })).json();
const packId = add.data.id;
const bad = path.join(root, "broken-pack"); mkdirSync(bad, { recursive: true });
writeFileSync(path.join(bad, "pack.ts"), `import { pack } from "watchwright";\nexport default pack({ name: "Blog", site: { key: "blog" }, tests: "./t/*.ts" , });\nconst x: number = ;`);
await fetch(base + "/packs", { method: "POST", headers: { "content-type": "application/json", "x-watchwright-client": "web" }, body: JSON.stringify({ path: bad }) });

const db = new Database(path.join(data, "watchwright.db"));
const plan = JSON.stringify([{ testId: "H1", title: "Home loads", number: 1, of: 1 }, { testId: "H2", title: "Search finds boots", number: 1, of: 1 }, { testId: "C1", title: "Add to cart", number: 1, of: 3 }, { testId: "C1", title: "Add to cart", number: 2, of: 3 }, { testId: "C1", title: "Add to cart", number: 3, of: 3 }, { testId: "K1", title: "Checkout as guest", number: 1, of: 1 }]);
const ins = db.prepare(`INSERT INTO runs (id, pack_id, pack_name, pack_path, site_key, job_kind, tests, params, options, status, plan, started_by, created_at, started_at, finished_at) VALUES (?, ?, 'Shop smoke', ?, 'shop', 'test', '[]', ?, '{}', ?, ?, ?, ?, ?, ?)`);
const att = db.prepare(`INSERT INTO runs_attempts (id, run_id, item_id, title, number, of_count, try, status, folder, started_at, finished_at) VALUES (?, ?, ?, 't', ?, 1, 1, ?, 'x', ?, ?)`);
const now = Date.now();
const iso = (minAgo) => new Date(now - minAgo * 60000).toISOString();
const runs = [
  ["a1b2c3d4", { model: "q9", lang: "en" }, "running", "web", 6, null, ["passed", "passed", "broken"]],
  ["0f9e8d7c", { model: "haiku", lang: "en" }, "queued", "claude-code", 0.5, null, []],
  ["5e6f7a8b", { model: "sonnet", lang: "en" }, "finished", "web", 95, 52, ["passed", "passed", "passed", "passed", "passed", "passed"]],
  ["9c8b7a6d", { model: "q9", lang: "de" }, "finished", "claude-code", 300, 260, ["passed", "failed", "passed", "broken", "passed", "skipped"]],
  ["1a2b3c4d", { model: "haiku", lang: "en" }, "stopped", "web", 1500, 1490, ["passed", "passed", "stopped"]],
  ["7d6c5b4a", { model: "q9", lang: "en" }, "interrupted", "api", 3000, null, ["passed", "failed"]],
];
for (const [id, params, status, by, startMin, endMin, outs] of runs) {
  ins.run(id, packId, packDir, JSON.stringify(params), status, plan, by, iso(startMin + 0.2), status === "queued" ? null : iso(startMin), endMin === null ? null : iso(endMin));
  outs.forEach((o, i) => att.run(id + String(i).padStart(4, "0"), id, ["H1", "H2", "C1", "C1", "C1", "K1"][i], i + 1, o, iso(startMin), iso(startMin)));
}
console.log(port);
