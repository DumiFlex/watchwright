import { createServer, type Server } from "node:http";
import type { FastifyInstance } from "fastify";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, describe, expect, it } from "vitest";
import { BUILTIN_PLUGINS } from "../src/core/builtin.js";
import { migrationsOf } from "../src/core/plugin.js";
import { AUTH_STORE } from "../src/plugins/auth/plugin.js";
import { PACK_ACCESS } from "../src/plugins/packs/access.js";
import { groupsOf, mergeSso, peerTest, roleFromGroups, DEFAULT_SSO } from "../src/plugins/auth/sso.js";
import { buildServer } from "../src/server/app.js";
import { openStore, type Store } from "../src/store/db.js";
import { freePort } from "./helpers/harness.js";

// Single sign-on (docs/plans/self-hosting.md, section 2.6): OpenID Connect against a small provider
// made here, and the trusted header.

const PORT = 7420;
const HOST = `127.0.0.1:${PORT}`;

const open: { app: FastifyInstance; store: Store }[] = [];
const servers: Server[] = [];
afterEach(async () => {
  for (const { app, store } of open.splice(0)) {
    await app.close();
    store.close();
  }
  for (const s of servers.splice(0)) await new Promise((r) => s.close(r));
});

/** A provider that signs in whoever `person` says, with `groups`. */
async function provider(person: { sub: string; preferred_username?: string; name?: string; groups?: string[] }) {
  const port = await freePort();
  const issuer = `http://127.0.0.1:${port}`;
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  const codes = new Map<string, { nonce: string; challenge: string }>();
  const seen: { authorize?: URL } = {};
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", issuer);
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === "/.well-known/openid-configuration")
      return json(200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        userinfo_endpoint: `${issuer}/userinfo`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        code_challenge_methods_supported: ["S256"],
      });
    if (url.pathname === "/jwks") return json(200, { keys: [jwk] });
    if (url.pathname === "/userinfo") return json(200, { sub: person.sub, groups: person.groups });
    if (url.pathname === "/token") {
      let body = "";
      req.on("data", (c: Buffer) => (body += c.toString()));
      req.on("end", () => {
        const form = new URLSearchParams(body);
        const code = codes.get(form.get("code") ?? "");
        if (!code || !form.get("code_verifier")) return json(400, { error: "invalid_grant" });
        void new SignJWT({ nonce: code.nonce, preferred_username: person.preferred_username, name: person.name })
          .setProtectedHeader({ alg: "RS256", kid: "k1" })
          .setIssuer(issuer)
          .setAudience("watchwright")
          .setSubject(person.sub)
          .setIssuedAt()
          .setExpirationTime("5m")
          .sign(privateKey)
          .then((idToken) => json(200, { access_token: "at", token_type: "Bearer", id_token: idToken, expires_in: 300 }));
      });
      return;
    }
    json(404, {});
  });
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
  servers.push(server);
  /** What the provider does when the browser arrives at its sign-in page: send it back with a code. */
  const authorize = (location: string) => {
    const u = new URL(location);
    seen.authorize = u;
    const code = `c${codes.size}`;
    codes.set(code, { nonce: u.searchParams.get("nonce") ?? "", challenge: u.searchParams.get("code_challenge") ?? "" });
    const back = new URL(u.searchParams.get("redirect_uri")!);
    back.searchParams.set("code", code);
    back.searchParams.set("state", u.searchParams.get("state")!);
    return back;
  };
  return { issuer, authorize, seen };
}

async function make() {
  const store = openStore(":memory:", migrationsOf(BUILTIN_PLUGINS));
  const app = await buildServer({ store, port: PORT, login: true });
  open.push({ app, store });
  const auth = app.watchwright.services.get(AUTH_STORE);
  const admin = await auth.add({ name: "boss", password: "correct horse battery", role: "admin" });
  const { token } = auth.addToken(admin.id, "test");
  const asAdmin = (method: "GET" | "POST", url: string, body?: unknown) => app.inject({ method, url: `/api/v1${url}`, headers: { host: HOST, authorization: `Bearer ${token}` }, ...(body ? { payload: body as object } : {}) });
  return { app, auth, asAdmin };
}

/** The browser's way through a sign-in: start, the provider, back to the callback. */
async function signInThrough(app: FastifyInstance, idp: Awaited<ReturnType<typeof provider>>) {
  const start = await app.inject({ method: "GET", url: "/api/v1/auth/oidc/start", headers: { host: HOST } });
  expect(start.statusCode).toBe(302);
  const bound = String(start.headers["set-cookie"]).split(";")[0]!;
  const back = idp.authorize(String(start.headers.location));
  return app.inject({ method: "GET", url: `${back.pathname}${back.search}`, headers: { host: HOST, cookie: bound } });
}

const sessionOf = (res: { headers: Record<string, unknown> }) => ([res.headers["set-cookie"]].flat() as string[]).find((c) => c.startsWith("ww_session=") && !c.startsWith("ww_session=;"))?.split(";")[0];

describe("single sign-on with OpenID Connect", () => {
  it("signs in through the provider, making the account with the role of its groups", async () => {
    const idp = await provider({ sub: "u-1", preferred_username: "robin", name: "Robin Hood", groups: ["staff", "ww-admins"] });
    const { app, auth, asAdmin } = await make();
    const set = await asAdmin("POST", "/auth/sso", { oidc: { on: true, name: "VoidAuth", issuer: idp.issuer, clientId: "watchwright", clientSecret: "s3cret" }, roles: [{ group: "ww-users", role: "user" }, { group: "ww-admins", role: "admin" }], otherRole: "none" });
    expect(set.statusCode).toBe(200);
    expect(set.json().data.oidc).toMatchObject({ on: true, hasSecret: true });
    expect(JSON.stringify(set.json())).not.toContain("s3cret");

    const me = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { host: HOST } });
    expect(me.json().data.signin).toEqual({ oidc: "VoidAuth", passwords: true });

    const res = await signInThrough(app, idp);
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/#/");
    expect(idp.seen.authorize?.searchParams.get("code_challenge_method")).toBe("S256");
    expect(idp.seen.authorize?.searchParams.get("redirect_uri")).toBe(`http://${HOST}/api/v1/auth/oidc/callback`);
    const cookie = sessionOf(res)!;
    const who = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { host: HOST, cookie } });
    expect(who.json().data.user).toMatchObject({ name: "robin", displayName: "Robin Hood", role: "admin" });
    expect(auth.users().find((u) => u.name === "robin")).toMatchObject({ source: "oidc", hasPassword: false, ssoGroups: ["staff", "ww-admins"], groups: [] });
  });

  it("refuses someone without a mapped group when others get no role, and a callback from another browser", async () => {
    const idp = await provider({ sub: "u-2", preferred_username: "eve", groups: ["guests"] });
    const { app, asAdmin } = await make();
    await asAdmin("POST", "/auth/sso", { oidc: { on: true, name: "Authentik", issuer: idp.issuer, clientId: "watchwright" }, roles: [{ group: "ww", role: "user" }], otherRole: "none" });
    const res = await signInThrough(app, idp);
    expect(res.headers.location).toMatch(/^\/#\/signin\?error=.*no%20access/);
    expect(sessionOf(res)).toBeUndefined();

    const start = await app.inject({ method: "GET", url: "/api/v1/auth/oidc/start", headers: { host: HOST } });
    const back = idp.authorize(String(start.headers.location));
    const stolen = await app.inject({ method: "GET", url: `${back.pathname}${back.search}`, headers: { host: HOST } });
    expect(stolen.headers.location).toMatch(/didn't%20start%20in%20this%20browser/);
  });

  it("won't save settings for a provider that doesn't answer", async () => {
    const { asAdmin } = await make();
    const port = await freePort();
    const res = await asAdmin("POST", "/auth/sso", { oidc: { on: true, name: "Nobody", issuer: `http://127.0.0.1:${port}`, clientId: "x" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("provider_unreachable");
    expect((await asAdmin("GET", "/auth/sso")).json().data.oidc.on).toBe(false);
  });

  it("keeps password sign-in for admins only when it's turned off", async () => {
    const { app, auth, asAdmin } = await make();
    await auth.add({ name: "sam", password: "correct horse battery", role: "user" });
    await asAdmin("POST", "/auth/sso", { passwords: false });
    const signin = (name: string) => app.inject({ method: "POST", url: "/api/v1/auth/signin", headers: { host: HOST }, payload: { name, password: "correct horse battery" } });
    expect((await signin("sam")).json().error.code).toBe("passwords_off");
    expect((await signin("boss")).statusCode).toBe(200);
  });
});

describe("single sign-on with a trusted header", () => {
  it("signs in whoever the proxy names, and refuses the header from anywhere else", async () => {
    const { app, asAdmin } = await make();
    const bad = await asAdmin("POST", "/auth/sso", { header: { on: true, user: "Remote-User", from: [] } });
    expect(bad.json().error.code).toBe("bad_input");
    await asAdmin("POST", "/auth/sso", { header: { on: true, user: "Remote-User", groups: "Remote-Groups", from: ["127.0.0.0/8"] }, roles: [{ group: "admins", role: "admin" }], otherRole: "viewer" });
    // app.inject comes from 127.0.0.1: the proxy here.
    const me = (headers: Record<string, string>) => app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { host: HOST, ...headers } });
    expect((await me({ "remote-user": "kim" })).json().data.user).toMatchObject({ name: "kim", role: "viewer" });
    expect((await me({ "remote-user": "lee", "remote-groups": "staff,admins" })).json().data.user).toMatchObject({ name: "lee", role: "admin" });
    const runs = await app.inject({ method: "GET", url: "/api/v1/runs", headers: { host: HOST, "remote-user": "kim" } });
    expect(runs.statusCode).toBe(200);
    // The header's groups count for pack access.
    app.watchwright.services.get(PACK_ACCESS).set("abcd1234", { people: [], groups: ["QA"] }, "test");
    const history = (headers: Record<string, string>) => app.inject({ method: "GET", url: "/api/v1/packs/abcd1234/history", headers: { host: HOST, "remote-user": "kim", ...headers } });
    expect((await history({})).statusCode).toBe(404);
    expect((await history({ "remote-groups": "staff,qa" })).statusCode).toBe(200);

    await asAdmin("POST", "/auth/sso", { header: { from: ["10.9.9.9"] } });
    const elsewhere = await app.inject({ method: "GET", url: "/api/v1/runs", headers: { host: HOST, "remote-user": "kim" } });
    expect(elsewhere.statusCode).toBe(401);
  });
});

describe("single sign-on pieces", () => {
  it("gives the highest role of the person's groups, else the role for anyone else", () => {
    const s = mergeSso(DEFAULT_SSO, { roles: [{ group: "Users", role: "user" }, { group: "admins", role: "admin" }], otherRole: "viewer" });
    expect(roleFromGroups(s, ["users", "admins"], false)).toEqual({ role: "admin", refused: false });
    expect(roleFromGroups(s, ["other"], false)).toEqual({ role: "viewer", refused: false });
    expect(roleFromGroups({ ...s, otherRole: "none" }, ["other"], true)).toEqual({ role: null, refused: true });
    // No mapping at all: an account keeps the role an admin gave it.
    expect(roleFromGroups({ ...s, roles: [] }, [], true)).toEqual({ role: null, refused: false });
  });

  it("reads groups and proxy addresses", () => {
    expect(groupsOf("a,b|c d")).toEqual(["a", "b", "c", "d"]);
    expect(groupsOf(["a", 1, ""])).toEqual(["a"]);
    const ok = peerTest(["172.18.0.0/16", "::1"]);
    expect(ok("172.18.3.4")).toBe(true);
    expect(ok("::ffff:172.18.0.9")).toBe(true);
    expect(ok("::1")).toBe(true);
    expect(ok("10.0.0.1")).toBe(false);
    expect(ok(undefined)).toBe(false);
    expect(() => peerTest(["nope"])).toThrow(/isn't an address/);
  });
});
