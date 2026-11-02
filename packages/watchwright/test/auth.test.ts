import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { defineAction } from "../src/actions/registry.js";
import { allows, whoCalls } from "../src/core/access.js";
import { BUILTIN_PLUGINS } from "../src/core/builtin.js";
import { LOGIN } from "../src/core/keys.js";
import { definePlugin, migrationsOf } from "../src/core/plugin.js";
import { loginOptions } from "../src/cli/serve.js";
import { AUTH_STORE, bearer, cookieValue } from "../src/plugins/auth/plugin.js";
import { checkPassword, hashPassword } from "../src/plugins/auth/store.js";
import { Throttle, FREE } from "../src/plugins/auth/throttle.js";
import { APPROVALS } from "../src/plugins/approvals/plugin.js";
import { buildServer } from "../src/server/app.js";
import { openStore, type Store } from "../src/store/db.js";

// Login (docs/plans/self-hosting.md, section 2): sessions, tokens, roles, and every route saying who may call it.

const PORT = 7420;
const HOST = `127.0.0.1:${PORT}`;
const ORIGIN = `http://${HOST}`;
const PASSWORD = "correct horse battery";

const open: { app: FastifyInstance; store: Store }[] = [];
afterEach(async () => {
  for (const { app, store } of open.splice(0)) {
    await app.close();
    store.close();
  }
});

const dropped: string[] = [];
const demo = definePlugin({
  name: "demo",
  actions: () => [
    defineAction<{ id: string }>({
      name: "demo.drop",
      title: "Drop a thing",
      method: "DELETE",
      path: "/things/:id",
      destructive: true,
      input: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      handler: ({ id }, { client }) => {
        dropped.push(`${id} by ${client}`);
        return { dropped: id };
      },
    }),
  ],
});

async function make(opts: { login?: boolean; publicUrls?: string[] } = {}) {
  const plugins = [...BUILTIN_PLUGINS, demo];
  const store = openStore(":memory:", migrationsOf(plugins));
  const app = await buildServer({ store, port: PORT, plugins, login: opts.login ?? true, ...(opts.publicUrls ? { publicUrls: opts.publicUrls } : {}) });
  open.push({ app, store });
  const auth = app.watchwright.services.get(AUTH_STORE);
  app.watchwright.services.get(APPROVALS).holdMs = 50;
  type Res = { status: number; body: { data?: Record<string, unknown> & unknown[]; error?: { code: string; message: string } }; cookie: string | undefined };
  const call = async (method: "GET" | "POST" | "DELETE", url: string, o: { body?: unknown; cookie?: string; token?: string; page?: boolean; host?: string; origin?: string } = {}): Promise<Res> => {
    const headers: Record<string, string> = { host: o.host ?? HOST };
    if (o.page || o.origin) headers.origin = o.origin ?? ORIGIN;
    if (o.cookie) headers.cookie = o.cookie;
    if (o.token) headers.authorization = `Bearer ${o.token}`;
    const res = await app.inject({ method, url: `/api/v1${url}`, headers, ...(o.body === undefined ? {} : { payload: o.body as object }) });
    const set = res.headers["set-cookie"];
    return { status: res.statusCode, body: res.json(), cookie: typeof set === "string" ? set.split(";")[0] : undefined };
  };
  const signIn = async (name: string, password = PASSWORD) => {
    const r = await call("POST", "/auth/signin", { body: { name, password }, page: true });
    expect(r.status).toBe(200);
    return r.cookie!;
  };
  return { app, store, auth, call, signIn };
}

describe("login off", () => {
  it("lets every call through, as before", async () => {
    const { call } = await make({ login: false });
    expect((await call("GET", "/runs")).status).toBe(200);
    expect((await call("GET", "/auth/users")).status).toBe(200);
    const me = await call("GET", "/auth/me");
    expect(me.body.data).toMatchObject({ on: false, user: null, setupNeeded: false });
    expect((await call("POST", "/auth/signin", { body: { name: "x", password: "y" }, page: true })).body.error?.code).toBe("login_off");
  });
});

describe("login on", () => {
  it("answers only what the sign-in page needs until someone signs in", async () => {
    const { call } = await make();
    const health = await call("GET", "/health");
    expect(health.status).toBe(200);
    expect(health.body.data).toMatchObject({ name: "watchwright", login: { on: true, user: null, setupNeeded: true } });
    expect(health.body.data).not.toHaveProperty("dataDir");
    const runs = await call("GET", "/runs");
    expect(runs.status).toBe(401);
    expect(runs.body.error?.code).toBe("sign_in_needed");
  });

  it("creates the first admin with the setup code, once", async () => {
    const { app, call } = await make();
    const code = app.watchwright.services.get(LOGIN).setupCode()!;
    expect(code).toBeTruthy();
    expect((await call("POST", "/auth/setup", { body: { code: "wrong", name: "dumi", password: PASSWORD }, page: true })).status).toBe(403);
    const made = await call("POST", "/auth/setup", { body: { code, name: "dumi", password: PASSWORD }, page: true });
    expect(made.status).toBe(200);
    expect(made.cookie).toMatch(/^ww_session=/);
    expect(app.watchwright.services.get(LOGIN).setupCode()).toBeNull();
    expect((await call("POST", "/auth/setup", { body: { code, name: "eve", password: PASSWORD }, page: true })).body.error?.code).toBe("set_up");
    const health = await call("GET", "/health", { cookie: made.cookie! });
    expect(health.body.data).toMatchObject({ login: { on: true, user: { name: "dumi", role: "admin" }, setupNeeded: false } });
    expect(health.body.data).toHaveProperty("dataDir");
  });

  it("signs in with a cookie, signs out, and refuses wrong passwords", async () => {
    const { auth, call, signIn } = await make();
    await auth.add({ name: "dumi", password: PASSWORD, role: "admin" });
    const wrong = await call("POST", "/auth/signin", { body: { name: "dumi", password: "nope nope nope" }, page: true });
    expect(wrong.status).toBe(401);
    const cookie = await signIn("Dumi");
    expect((await call("GET", "/runs", { cookie })).status).toBe(200);
    const me = await call("GET", "/auth/me", { cookie });
    expect(me.body.data).toMatchObject({ on: true, user: { name: "dumi", role: "admin", via: "session" } });
    await call("POST", "/auth/signout", { cookie, page: true });
    expect((await call("GET", "/runs", { cookie })).status).toBe(401);
  });

  it("slows down guessing", async () => {
    const { auth, call } = await make();
    await auth.add({ name: "dumi", password: PASSWORD, role: "admin" });
    for (let i = 0; i < FREE; i++) expect((await call("POST", "/auth/signin", { body: { name: "dumi", password: `guess ${i} guess` }, page: true })).status).toBe(401);
    const blocked = await call("POST", "/auth/signin", { body: { name: "dumi", password: PASSWORD }, page: true });
    expect(blocked.status).toBe(429);
  });

  it("checks roles: viewers read, users change, admins manage", async () => {
    const { auth, call, signIn } = await make();
    await auth.add({ name: "admin1", password: PASSWORD, role: "admin" });
    await auth.add({ name: "val", password: PASSWORD, role: "viewer" });
    await auth.add({ name: "uma", password: PASSWORD, role: "user" });
    const viewer = await signIn("val");
    const user = await signIn("uma");
    const admin = await signIn("admin1");
    expect((await call("GET", "/runs", { cookie: viewer })).status).toBe(200);
    const preset = { name: "p", packId: "000000000000" };
    expect((await call("POST", "/presets", { cookie: viewer, page: true, body: preset })).body.error?.code).toBe("not_allowed");
    expect((await call("GET", "/auth/users", { cookie: user })).status).toBe(403);
    expect((await call("GET", "/secrets", { cookie: viewer })).status).toBe(403);
    expect((await call("GET", "/secrets", { cookie: user })).status).toBe(200);
    expect((await call("POST", "/secrets", { cookie: user, page: true, body: { name: "A", value: "b" } })).status).toBe(403);
    expect((await call("POST", "/settings", { cookie: user, page: true, body: { key: "settings.editor", value: "vscode" } })).status).toBe(403);
    const users = await call("GET", "/auth/users", { cookie: admin });
    expect(users.status).toBe(200);
    expect(users.body.data).toHaveLength(3);
  });

  it("takes API tokens, never as the web page", async () => {
    const { auth, call, signIn } = await make();
    await auth.add({ name: "dumi", password: PASSWORD, role: "user" });
    const cookie = await signIn("dumi");
    const made = await call("POST", "/auth/tokens", { cookie, page: true, body: { name: "laptop" } });
    expect(made.status).toBe(201);
    const token = (made.body.data as unknown as { token: string }).token;
    expect(token).toMatch(/^ww_/);
    expect((await call("GET", "/runs", { token })).status).toBe(200);
    expect((await call("GET", "/runs", { token: "ww_made_up" })).status).toBe(401);
    // A destructive call with a token waits for approval even when it sends the page's Origin.
    const held = await call("DELETE", "/things/t1", { token, origin: ORIGIN });
    expect(held.status).toBe(202);
    const list = await call("GET", "/auth/tokens", { token });
    expect(list.body.data).toHaveLength(1);
    const id = (list.body.data as unknown as { id: string }[])[0]!.id;
    expect((await call("DELETE", `/auth/tokens/${id}`, { cookie, page: true })).status).toBe(200);
    expect((await call("GET", "/runs", { token })).status).toBe(401);
  });

  it("lets the asker or an admin answer an approval, and names the person", async () => {
    const { app, auth, call, signIn } = await make();
    await auth.add({ name: "admin1", password: PASSWORD, role: "admin" });
    await auth.add({ name: "uma", password: PASSWORD, role: "user" });
    await auth.add({ name: "ulf", password: PASSWORD, role: "user" });
    const uma = await signIn("uma");
    const ulf = await signIn("ulf");
    const admin = await signIn("admin1");
    const token = (await call("POST", "/auth/tokens", { cookie: uma, page: true, body: { name: "agent" } })).body.data as unknown as { token: string };
    const asked = await call("DELETE", "/things/t2", { token: token.token });
    expect(asked.status).toBe(202);
    const approvals = app.watchwright.services.get(APPROVALS);
    const a = approvals.list("waiting")[0]!;
    expect(a.client).toBe("uma");
    expect((await call("POST", `/approvals/${a.id}/answer`, { cookie: ulf, page: true, body: { approve: true } })).status).toBe(403);
    expect((await call("POST", `/approvals/${a.id}/answer`, { cookie: admin, page: true, body: { approve: true } })).status).toBe(200);
    expect(dropped).toContain("t2 by uma");
  });

  it("changes a password, keeping only the session that changed it", async () => {
    const { auth, call, signIn } = await make();
    await auth.add({ name: "dumi", password: PASSWORD, role: "viewer" });
    const a = await signIn("dumi");
    const b = await signIn("dumi");
    expect((await call("POST", "/auth/password", { cookie: a, page: true, body: { current: "wrong wrong", password: "another long one" } })).status).toBe(403);
    expect((await call("POST", "/auth/password", { cookie: a, page: true, body: { current: PASSWORD, password: "another long one" } })).status).toBe(200);
    expect((await call("GET", "/runs", { cookie: a })).status).toBe(200);
    expect((await call("GET", "/runs", { cookie: b })).status).toBe(401);
    await signIn("dumi", "another long one");
  });

  it("keeps the last admin", async () => {
    const { auth } = await make();
    const admin = await auth.add({ name: "dumi", password: PASSWORD, role: "admin" });
    await expect(auth.update(admin.id, { role: "user" })).rejects.toThrow(/only admin/);
    await expect(auth.update(admin.id, { disabled: true })).rejects.toThrow(/only admin/);
    expect(() => auth.remove(admin.id)).toThrow(/only admin/);
  });

  it("allows the public address's host and origin", async () => {
    const { auth, call, signIn } = await make({ publicUrls: ["https://watchwright.home.lan"] });
    await auth.add({ name: "dumi", password: PASSWORD, role: "admin" });
    const cookie = await signIn("dumi");
    expect((await call("GET", "/runs", { cookie, host: "watchwright.home.lan" })).status).toBe(200);
    expect((await call("GET", "/runs", { cookie, host: "evil.example" })).body.error?.code).toBe("bad_host");
    const preset = { name: "p", packId: "000000000000" };
    expect((await call("POST", "/presets", { cookie, host: "watchwright.home.lan", origin: "https://watchwright.home.lan", body: preset })).body.error?.code).not.toBe("bad_origin");
    expect((await call("POST", "/presets", { cookie, host: "watchwright.home.lan", origin: "https://evil.example", body: preset })).body.error?.code).toBe("bad_origin");
  });

  it("every API route says who may call it", async () => {
    const { app } = await make();
    const api = app.watchwrightRoutes.filter((r) => r.url.startsWith("/api/v1") && r.method !== "HEAD");
    expect(api.length).toBeGreaterThan(50);
    const missing = api.filter((r) => r.access === undefined).map((r) => `${r.method} ${r.url}`);
    expect(missing).toEqual([]);
  });
});

describe("pieces", () => {
  it("hashes and checks passwords", async () => {
    const h = await hashPassword(PASSWORD);
    expect(h).toMatch(/^scrypt\$/);
    expect(await checkPassword(PASSWORD, h)).toBe(true);
    expect(await checkPassword("wrong", h)).toBe(false);
  });

  it("reads cookies and bearer tokens", () => {
    expect(cookieValue("a=1; ww_session=abc; b=2")).toBe("abc");
    expect(cookieValue("a=1")).toBeNull();
    expect(bearer("Bearer ww_x")).toBe("ww_x");
    expect(bearer("Basic x")).toBeNull();
  });

  it("orders roles", () => {
    const u = (role: "viewer" | "user" | "admin") => ({ id: "1", name: "n", role, via: "session" as const });
    expect(allows("viewer", u("viewer"))).toBe(true);
    expect(allows("user", u("viewer"))).toBe(false);
    expect(allows("admin", u("user"))).toBe(false);
    expect(allows("public", null)).toBe(true);
    expect(allows("viewer", null)).toBe(false);
    expect(allows("admin", undefined)).toBe(true);
    expect(whoCalls("web", u("user"))).toBe("n");
    expect(whoCalls("Claude Code", u("user"))).toBe("n via Claude Code");
    expect(whoCalls("cli", undefined)).toBe("cli");
  });

  it("throttles after the free tries and forgets after a success", () => {
    let t = 0;
    const th = new Throttle(() => t);
    for (let i = 0; i < FREE; i++) th.failed(["k"]);
    expect(th.waitMs(["k"])).toBe(1000);
    t = 1000;
    expect(th.waitMs(["k"])).toBe(0);
    th.failed(["k"]);
    expect(th.waitMs(["k"])).toBe(2000);
    th.cleared(["k"]);
    expect(th.waitMs(["k"])).toBe(0);
  });

  it("reads login options from flags and the environment", () => {
    expect(loginOptions({}, {})).toEqual({ on: false, publicUrls: [], trustProxy: [] });
    expect(loginOptions({}, { WATCHWRIGHT_AUTH: "on", WATCHWRIGHT_PUBLIC_URL: "https://a.lan, http://b.lan:8080", WATCHWRIGHT_TRUST_PROXY: "172.18.0.0/16" })).toEqual({
      on: true,
      publicUrls: ["https://a.lan", "http://b.lan:8080"],
      trustProxy: ["172.18.0.0/16"],
    });
    expect(loginOptions({ auth: true, "public-url": ["ftp://x"] }, {})).toMatch(/http/);
    expect(loginOptions({}, { WATCHWRIGHT_AUTH: "maybe" })).toMatch(/on or off/);
  });
});
