import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "../src/cli/client.js";
import { credentialsPath, savedLogin, serverKey, tokenFor } from "../src/cli/credentials.js";
import { loginCommand, logoutCommand, type LoginIo } from "../src/cli/login.js";
import { BUILTIN_PLUGINS } from "../src/core/builtin.js";
import { migrationsOf } from "../src/core/plugin.js";
import { AUTH_STORE } from "../src/plugins/auth/plugin.js";
import { buildServer } from "../src/server/app.js";
import { openStore, type Store } from "../src/store/db.js";
import { freePort } from "./helpers/harness.js";

// `watchwright login` / `logout` and the saved token (docs/plans/self-hosting.md, section 3).

const PASSWORD = "correct horse battery";
const open: { app: FastifyInstance; store: Store; dir: string }[] = [];
const envBefore = { ...process.env };
afterEach(async () => {
  process.env = { ...envBefore };
  for (const { app, store, dir } of open.splice(0)) {
    await app.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

async function start(login = true) {
  const port = await freePort();
  const store = openStore(":memory:", migrationsOf(BUILTIN_PLUGINS));
  const app = await buildServer({ store, port, login });
  await app.listen({ port, host: "127.0.0.1" });
  const dir = mkdtempSync(path.join(os.tmpdir(), "ww-config-"));
  open.push({ app, store, dir });
  // Saved logins go to a temp config folder, never the person's own.
  process.env.WATCHWRIGHT_CONFIG_DIR = dir;
  delete process.env.WATCHWRIGHT_TOKEN;
  if (login) await app.watchwright.services.get(AUTH_STORE).add({ name: "dumi", password: PASSWORD, role: "user" });
  return { app, base: `http://127.0.0.1:${port}/`, dir };
}

function io(answers: { name?: string; password?: string } = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const it: LoginIo = {
    out: (s) => out.push(s),
    err: (s) => err.push(s),
    ask: () => Promise.resolve(answers.name ?? null),
    password: () => Promise.resolve(answers.password ?? null),
    stdinLine: () => Promise.resolve(`${answers.password ?? ""}\n`),
  };
  return { io: it, out, err };
}

describe("watchwright login", () => {
  it("signs in, saves a token for the server, and the CLI sends it", async () => {
    const { app, base } = await start();
    const client = new Client(base, "cli");
    await expect(client.request("GET", "/runs")).rejects.toMatchObject({
      code: "sign_in_needed",
    });

    const t = io({ name: "dumi", password: PASSWORD });
    expect(await loginCommand(["--server", base], t.io)).toBe(0);
    expect(t.out.join("\n")).toMatch(/Signed in to .* as dumi \(user\)/);
    const saved = savedLogin(base)!;
    expect(saved.token).toMatch(/^ww_/);
    expect(saved.user).toBe("dumi");
    if (process.platform !== "win32") expect(statSync(credentialsPath()).mode & 0o777).toBe(0o600);
    // The token is named after the machine, and the sign-in that made it has ended.
    const auth = app.watchwright.services.get(AUTH_STORE);
    expect(auth.tokens().map((x) => x.name)).toEqual([`CLI on ${os.hostname()}`]);
    expect(await client.request("GET", "/runs")).toEqual(expect.any(Array));

    // WATCHWRIGHT_TOKEN wins over the saved one.
    process.env.WATCHWRIGHT_TOKEN = "ww_nope";
    expect(tokenFor(base)).toBe("ww_nope");
    delete process.env.WATCHWRIGHT_TOKEN;

    const out = io();
    expect(await logoutCommand(["--server", base], out.io)).toBe(0);
    expect(out.out.join("\n")).toBe(`Signed out of ${base} on this machine.`);
    expect(savedLogin(base)).toBeNull();
    expect(auth.tokens()).toEqual([]);
  });

  it("refuses a wrong password and saves nothing", async () => {
    const { base, dir } = await start();
    const t = io({ name: "dumi", password: "not the password" });
    expect(await loginCommand(["--server", base], t.io)).toBe(1);
    expect(t.err.join("\n")).toMatch(/don't match/);
    expect(() => readFileSync(path.join(dir, "credentials.json"))).toThrow();
  });

  it("reads the password from standard input, and saves a token made on the web page", async () => {
    const { app, base } = await start();
    const t = io({ password: PASSWORD });
    expect(await loginCommand(["--server", base, "--name", "dumi", "--password-stdin"], t.io)).toBe(0);
    await logoutCommand(["--server", base], io().io);

    const auth = app.watchwright.services.get(AUTH_STORE);
    const user = auth.users().find((u) => u.name === "dumi")!;
    const made = auth.addToken(user.id, "Laptop");
    const w = io();
    expect(await loginCommand(["--server", base, "--token", made.token], w.io)).toBe(0);
    expect(savedLogin(base)?.tokenId).toBe(made.info.id);
    expect(await loginCommand(["--server", base, "--token", "ww_wrong"], io().io)).toBe(1);
    // Logout removes even a token saved this way.
    await logoutCommand(["--server", base], io().io);
    expect(auth.tokens()).toEqual([]);
  });

  it("says when the server has login off", async () => {
    const { base } = await start(false);
    const t = io();
    expect(await loginCommand(["--server", base], t.io)).toBe(0);
    expect(t.out.join("\n")).toContain("Login is off");
    expect(savedLogin(base)).toBeNull();
  });

  it("keys saved logins by origin", () => {
    expect(serverKey("http://127.0.0.1:7420/")).toBe("http://127.0.0.1:7420");
    expect(serverKey("https://ww.example.com")).toBe("https://ww.example.com");
  });
});
