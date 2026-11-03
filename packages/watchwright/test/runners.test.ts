import { createServer, type Server } from "node:http";
import net from "node:net";
import Database from "better-sqlite3";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { connectRunner, pairRunner, readRunnerConfig, type RunnerHandle } from "../src/cli/runner.js";
import { allows, parseAllow } from "../src/plugins/runners/allow.js";
import { RUNNERS } from "../src/plugins/runners/plugin.js";
import { RUNNERS_SQL, RunnersStore } from "../src/plugins/runners/store.js";
import type { RunDetail } from "../src/plugins/runs/engine.js";
import { cleanTempDirs, startSite, tempDir, writeFiles } from "./helpers/fixtures.js";
import { engineOf, hasChromium, requireBrowsers, startHarness, type Harness } from "./helpers/harness.js";

// Runners: a machine that lets runs reach sites only it can reach. Paired with a one-time code,
// connected over a WebSocket, carrying the browser's connections through a SOCKS listener.

const quiet = { info: () => undefined, warn: () => undefined };
const harnesses: Harness[] = [];
const runners: RunnerHandle[] = [];
afterEach(async () => {
  for (const r of runners.splice(0)) r.close();
  for (const h of harnesses.splice(0)) await h.close();
  cleanTempDirs();
});

async function harness(): Promise<Harness> {
  const h = await startHarness(tempDir("ww-data-"), { listen: true });
  harnesses.push(h);
  return h;
}

/** Adds a runner on the server and connects one to it, paired through the API as the command does. */
async function runner(h: Harness, name: string, allow: string[]): Promise<{ id: string; handle: RunnerHandle }> {
  const added = await h.api<{ runner: { id: string }; code: string; command: string; installCommand: string }>("POST", "/runners", { name, server: `http://${h.host}` });
  expect(added.status).toBe(201);
  expect(added.data.installCommand).toBe(added.data.command.replace(" runner ", " runner install "));
  expect(added.data.command).toMatch(new RegExp(`^npx watchwright@\\S+ runner --server http://${h.host.replace(/\./g, "\\.")} --pair [2-9A-Z]{3}-[2-9A-Z]{3}-[2-9A-Z]{3}$`));
  const env = { WATCHWRIGHT_CONFIG_DIR: tempDir("ww-cfg-") };
  const base = `http://${h.host}/`;
  await pairRunner(base, added.data.code, allow, env);
  const saved = readRunnerConfig(env).servers[`http://${h.host}`]!;
  expect(saved).toMatchObject({ name, allow });
  const handle = connectRunner({ base, token: saved.token, allow: saved.allow, log: quiet });
  runners.push(handle);
  await handle.ready;
  return { id: added.data.runner.id, handle };
}

/** GET through a SOCKS5 proxy, by hand: the whole answer as bytes. */
function socksGet(proxyPort: number, host: string, port: number, path: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const s = net.connect(proxyPort, "127.0.0.1");
    let stage = 0;
    let buf = Buffer.alloc(0);
    const chunks: Buffer[] = [];
    s.on("error", reject);
    s.on("connect", () => s.write(Buffer.from([5, 1, 0])));
    s.on("data", (d: Buffer) => {
      if (stage === 2) return void chunks.push(d);
      buf = Buffer.concat([buf, d]);
      if (stage === 0 && buf.length >= 2) {
        buf = buf.subarray(2);
        stage = 1;
        const h = Buffer.from(host);
        const p = Buffer.alloc(2);
        p.writeUInt16BE(port);
        s.write(Buffer.concat([Buffer.from([5, 1, 0, 3, h.length]), h, p]));
      }
      if (stage === 1 && buf.length >= 10) {
        if (buf[1] !== 0) return reject(new Error(`SOCKS reply ${buf[1]}`));
        stage = 2;
        if (buf.length > 10) chunks.push(buf.subarray(10));
        s.write(`GET ${path} HTTP/1.1\r\nHost: ${host}:${port}\r\nConnection: close\r\n\r\n`);
      }
    });
    s.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

describe("allow lists", () => {
  it("parses loopback, host:port and host:*, and refuses the rest", () => {
    expect(parseAllow("")).toEqual(["loopback"]);
    expect(parseAllow("loopback, LOCALHOST:3000 192.168.1.20:*")).toEqual(["loopback", "localhost:3000", "192.168.1.20:*"]);
    for (const bad of ["localhost", "x:0", "x:70000", "http://x:1", "*:*"]) expect(() => parseAllow(bad), bad).toThrow();
  });

  it("treats localhost, 127.x and ::1 as one host", () => {
    expect(allows(["loopback"], "localhost", 8188)).toBe(true);
    expect(allows(["loopback"], "127.0.0.5", 1)).toBe(true);
    expect(allows(["loopback"], "[::1]", 1)).toBe(true);
    expect(allows(["loopback"], "192.168.1.2", 80)).toBe(false);
    expect(allows(["localhost:3000"], "127.0.0.1", 3000)).toBe(true);
    expect(allows(["localhost:3000"], "127.0.0.1", 3001)).toBe(false);
    expect(allows(["nas.lan:*"], "NAS.lan", 5000)).toBe(true);
    expect(allows(["nas.lan:*"], "nas.lan.evil.com", 5000)).toBe(false);
  });
});

describe("RunnersStore", () => {
  it("trades a pair code once, in any case and spacing, for a token", () => {
    const db = new Database(":memory:");
    db.exec(RUNNERS_SQL);
    const s = new RunnersStore(db);
    const r = s.add("Office PC", ["loopback"], "admin");
    const first = s.pairCode(r.id);
    const { code } = s.pairCode(r.id);
    expect(s.pair(first.code)).toBeNull();
    const paired = s.pair(` ${code.toLowerCase().replace(/-/g, " ")} `)!;
    expect(paired.runner.name).toBe("Office PC");
    expect(s.pair(code)).toBeNull();
    expect(s.byToken(paired.token)?.id).toBe(r.id);
    // Pairing again (a new machine) retires the old token.
    const again = s.pair(s.pairCode(r.id).code)!;
    expect(s.byToken(paired.token)).toBeNull();
    expect(s.byToken(again.token)?.id).toBe(r.id);
    expect(s.get("office pc")?.id).toBe(r.id);
    db.prepare("UPDATE runners_pairs SET expires_at = ?").run(new Date(Date.now() - 1000).toISOString());
    const late = s.pairCode(r.id);
    db.prepare("UPDATE runners_pairs SET expires_at = ?").run(new Date(Date.now() - 1000).toISOString());
    expect(s.pair(late.code)).toBeNull();
  });
});

describe("runners", () => {
  let big: Server;
  let bigPort = 0;
  const BODY = Buffer.alloc(3 * 1024 * 1024, "x");
  beforeAll(async () => {
    big = createServer((req, res) => res.writeHead(200, { "content-type": "text/plain", "content-length": BODY.length }).end(BODY));
    await new Promise<void>((r) => big.listen(0, "127.0.0.1", r));
    bigPort = (big.address() as net.AddressInfo).port;
  });
  afterAll(async () => {
    await new Promise((r) => big.close(r));
  });

  it("pairs, shows as connected, and carries connections it allows", async () => {
    const h = await harness();
    const { id } = await runner(h, "Lab PC", [`localhost:${bigPort}`]);
    const list = await h.api<{ name: string; online: boolean; allow: string[]; version: string }[]>("GET", "/runners");
    expect(list.data).toEqual([expect.objectContaining({ name: "Lab PC", online: true, allow: [`localhost:${bigPort}`] })]);
    expect(h.app.watchwright.events.after(0).map((e) => e.type)).toContain("runner.connected");

    const refused: string[] = [];
    const proxy = await h.app.watchwright.services.get(RUNNERS).proxy("lab pc", (m) => refused.push(m));
    const port = Number(proxy.server.split(":").pop());
    try {
      // 3 MB through 256 KB windows: credit has to flow for it to finish.
      const answer = await socksGet(port, "localhost", bigPort, "/");
      expect(answer.toString("latin1")).toMatch(/^HTTP\/1\.1 200/);
      expect(answer.length).toBeGreaterThan(BODY.length);
      await expect(socksGet(port, "localhost", bigPort + 1, "/")).rejects.toThrow(/SOCKS reply 5/);
      expect(refused[0]).toMatch(/doesn't allow localhost:\d+/);
    } finally {
      await proxy.close();
    }

    // Removing it tells it first (it cleans up its machine and says so), disconnects it and ends `watchwright runner`.
    const removed = await h.api<{ online: boolean; cleaned: boolean; uninstallCommand: string }>("DELETE", `/runners/${id}`);
    expect(removed.status).toBe(200);
    expect(removed.data).toMatchObject({ online: true, cleaned: true, uninstallCommand: "npx watchwright runner uninstall --forget" });
    expect(await runners[0]!.ended).toMatch(/removed/);
    await h.waitFor((e) => e.type === "runner.disconnected");
  });

  it("removes itself from its machine when removed, now or the next time it connects", async () => {
    const h = await harness();
    const { store } = h.app.watchwright.services.get(RUNNERS);
    const cleaned: string[] = [];
    const connect = (name: string, token: string) => {
      const handle = connectRunner({
        base: `http://${h.host}/`,
        token,
        allow: ["loopback"],
        log: quiet,
        service: "systemd",
        onRemoved: async () => {
          cleaned.push(name);
          return true;
        },
      });
      runners.push(handle);
      return handle;
    };
    const a = store.add("Desk", ["loopback"], null);
    const desk = connect("Desk", store.pair(store.pairCode(a.id).code)!.token);
    await desk.ready;
    expect(store.get("Desk")?.service).toBe("systemd");
    expect((await h.api<{ service: string }[]>("GET", "/runners")).data[0]).toMatchObject({ service: "systemd" });
    expect((await h.api<{ cleaned: boolean }>("DELETE", `/runners/${a.id}`)).data).toMatchObject({ online: true, cleaned: true });
    await desk.ended;
    expect(cleaned).toEqual(["Desk"]);

    // Removed while offline: its token is refused with a reason the next time, and it cleans up then.
    const b = store.add("Laptop", ["loopback"], null);
    const token = store.pair(store.pairCode(b.id).code)!.token;
    expect((await h.api<{ online: boolean; cleaned: boolean }>("DELETE", `/runners/${b.id}`)).data).toMatchObject({ online: false, cleaned: false });
    const laptop = connect("Laptop", token);
    await expect(laptop.ready).rejects.toThrow(/token doesn't work/);
    expect(cleaned).toEqual(["Desk", "Laptop"]);
  });

  it("keeps trying until the server answers", { timeout: 20_000 }, async () => {
    const h = await startHarness(tempDir("ww-data-"));
    harnesses.push(h);
    const { store } = h.app.watchwright.services.get(RUNNERS);
    const r = store.add("Late", ["loopback"], null);
    const { token } = store.pair(store.pairCode(r.id).code)!;
    const handle = connectRunner({ base: `http://${h.host}/`, token, allow: ["loopback"], log: quiet });
    runners.push(handle);
    // Nothing listens yet: Node's WebSocket reports that with an error alone, and the runner tries again.
    await new Promise((res) => setTimeout(res, 1500));
    await h.app.listen({ port: h.port, host: "127.0.0.1" });
    await expect(handle.ready).resolves.toEqual({ name: "Late" });
  });

  it("refuses bad pair codes and tokens, and needs a known, connected runner for a proxy", async () => {
    const h = await harness();
    const env = { WATCHWRIGHT_CONFIG_DIR: tempDir("ww-cfg-") };
    await expect(pairRunner(`http://${h.host}/`, "AAA-BBB-CCC", undefined, env)).rejects.toThrow(/doesn't work/);
    const bad = connectRunner({ base: `http://${h.host}/`, token: "wwr_nope", allow: ["loopback"], log: quiet });
    runners.push(bad);
    await expect(bad.ready).rejects.toThrow(/token doesn't work/);
    const svc = h.app.watchwright.services.get(RUNNERS);
    await expect(svc.proxy("Nobody", () => undefined)).rejects.toThrow(/No runner "Nobody"/);
    await h.api("POST", "/runners", { name: "Sleepy" });
    await expect(svc.proxy("Sleepy", () => undefined)).rejects.toThrow(/offline/);
    expect((await h.api("POST", "/runners", { name: "sleepy" })).status).toBe(409);
    expect((await h.api("POST", "/runners", { name: "X", allow: "everything" })).status).toBe(400);
  });
});

const engine = hasChromium || requireBrowsers ? describe : describe.skip;

engine("runs through a runner", { timeout: 90_000 }, () => {
  let site: { url: string; close(): Promise<void> };
  beforeAll(async () => {
    site = await startSite();
  });
  afterAll(async () => {
    await site.close();
  });

  it("reach the site from the runner, and only what it allows", async () => {
    const h = await harness();
    const sitePort = Number(new URL(site.url).port);
    const dir = tempDir("ww-pack-");
    writeFiles(dir, {
      "pack.yaml": `name: Through\nsite: { key: through, baseURL: "http://localhost:${sitePort}/", network: Lab }\nrun: { video: false }\n`,
      "tests/a.yaml": "tests:\n  - id: HOME\n    steps:\n      - goto: /\n      - expect: { target: h1, text: Fixture home }\n",
    });
    const added = await h.api<{ id: string }>("POST", "/packs", { path: dir });
    const run = async (body: Record<string, unknown> = {}) => {
      const res = await h.api<{ id: string }>("POST", "/runs", { packId: added.data.id, pauseOnBroken: false, ...body });
      expect(res.error, JSON.stringify(res.error)).toBeUndefined();
      const id = res.data.id;
      await h.waitFor((e) => e.runId === id && (e.type === "run.finished" || e.type === "run.failed_to_start"), 45_000);
      await engineOf(h).settled(id);
      return (await h.api<RunDetail>("GET", `/runs/${id}`)).data;
    };

    await h.api("POST", "/runners", { name: "Lab" });
    const offline = await run();
    expect(offline.status).toBe("failed_to_start");
    expect(offline.error).toMatch(/runner "Lab" is offline/);
    // The run's own choice wins over the pack's.
    expect((await run({ network: "server" })).attempts.map((a) => a.status)).toEqual(["passed"]);

    await h.api("DELETE", `/runners/${(await h.api<{ id: string }[]>("GET", "/runners")).data[0]!.id}`);
    const { handle } = await runner(h, "Lab", ["localhost:1"]);
    const blocked = await run();
    expect(blocked.attempts.map((a) => a.status)).not.toEqual(["passed"]);
    const logs = h.app.watchwright.events.after(0).filter((e) => e.runId === blocked.id && e.type === "run.log").map((e) => String(e.data.message));
    expect(logs.join("\n")).toMatch(new RegExp(`Runner Lab didn't open localhost:${sitePort}`));
    handle.close();

    await h.api("DELETE", `/runners/${(await h.api<{ id: string }[]>("GET", "/runners")).data[0]!.id}`);
    await runner(h, "Lab", ["loopback"]);
    const ok = await run();
    expect(ok.attempts.map((a) => a.status)).toEqual(["passed"]);
  });
});
