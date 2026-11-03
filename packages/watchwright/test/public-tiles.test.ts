import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { BUILTIN_PLUGINS } from "../src/core/builtin.js";
import { migrationsOf } from "../src/core/plugin.js";
import { AUTH_STORE } from "../src/plugins/auth/plugin.js";
import { buildServer } from "../src/server/app.js";
import { openStore, type Store } from "../src/store/db.js";
import { cleanTempDirs, tempDir, writeFiles } from "./helpers/fixtures.js";

// What the public status page and shares show is the server's face to strangers, so with login on
// only admins change it: the tiles marked public and the runs they read. Users still change the
// rest of a pack's dashboard.

const HOST = "127.0.0.1:7420";
const PASSWORD = "correct horse battery";

const open: { app: FastifyInstance; store: Store }[] = [];
afterEach(async () => {
  for (const { app, store } of open.splice(0)) {
    await app.close();
    store.close();
  }
  cleanTempDirs();
});

async function make() {
  const store = openStore(":memory:", migrationsOf(BUILTIN_PLUGINS));
  const app = await buildServer({ store, port: 7420, plugins: BUILTIN_PLUGINS, login: true });
  open.push({ app, store });
  const auth = app.watchwright.services.get(AUTH_STORE);
  await auth.add({ name: "ada", password: PASSWORD, role: "admin" });
  await auth.add({ name: "uma", password: PASSWORD, role: "user" });
  const signIn = async (name: string) => {
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/signin", headers: { host: HOST, origin: `http://${HOST}` }, payload: { name, password: PASSWORD } });
    return String(res.headers["set-cookie"]).split(";")[0]!;
  };
  const call = async (method: "GET" | "POST" | "DELETE", url: string, cookie: string, body?: unknown) => {
    const res = await app.inject({ method, url: `/api/v1${url}`, headers: { host: HOST, origin: `http://${HOST}`, cookie }, ...(body === undefined ? {} : { payload: body as object }) });
    return { status: res.statusCode, body: res.json() as { data?: { source: string }; error?: { code: string } } };
  };
  const admin = await signIn("ada");
  const user = await signIn("uma");
  const dir = tempDir("ww-pack-");
  writeFiles(dir, {
    "pack.yaml": "name: Shop\nsite: { key: shop, baseURL: http://127.0.0.1:9/ }\ndashboard:\n  tiles:\n    - { outcome: true, width: 2 }\n    - { duration: true, width: 2 }\n",
    "tests/home.yaml": "id: H1\ntitle: Home\nsteps:\n  - goto: /\n",
  });
  const res = await call("POST", "/packs", admin, { path: dir });
  return { call, admin, user, url: `/packs/${String((res.body.data as unknown as { id: string }).id)}/dashboard` };
}

const OWN = [{ outcome: true, width: 2 }, { duration: true, width: 2 }];

describe("public dashboard tiles", () => {
  it("lets users change tiles that aren't public, and only admins the public ones", async () => {
    const { call, admin, user, url } = await make();
    // A private tile beside the pack's public ones: fine for a user.
    const mine = await call("POST", url, user, { tiles: [...OWN, { metric: "Load ms", public: false }] });
    expect(mine.status).toBe(200);
    expect(mine.body.data?.source).toBe("override");
    // Changing it again, still private: fine.
    expect((await call("POST", url, user, { tiles: [...OWN, { metric: "Load ms", of: "median", public: false }] })).status).toBe(200);
    // Dropping the override goes back to the same public tiles: fine.
    expect((await call("DELETE", url, user)).status).toBe(200);

    // A new public tile, a public tile gone, a changed one, or another range: admins only.
    for (const body of [
      { tiles: [...OWN, { metric: "Load ms" }] },
      { tiles: [OWN[0]] },
      { tiles: [OWN[0], { duration: true, width: 4 }] },
      { tiles: [...OWN, { metric: "Load ms", public: false }], runs: 5 },
    ]) {
      const refused = await call("POST", url, user, body);
      expect(refused.status, JSON.stringify(body)).toBe(403);
      expect(refused.body.error?.code).toBe("public_tiles_admin_only");
    }
    expect((await call("POST", url, admin, { tiles: [...OWN, { metric: "Load ms" }] })).status).toBe(200);
    // Now a reset would take a public tile away: admins only too.
    expect((await call("DELETE", url, user)).body.error?.code).toBe("public_tiles_admin_only");
    expect((await call("DELETE", url, admin)).body.data?.source).toBe("pack");
  });
});
