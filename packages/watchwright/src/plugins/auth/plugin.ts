import { randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ActionError, defineAction, type ActionCall } from "../../actions/registry.js";
import { ROLES, type CallUser, type CredentialHeaders, type Login, type Role } from "../../core/access.js";
import { LOGIN, LOGIN_OPTIONS } from "../../core/keys.js";
import { definePlugin } from "../../core/plugin.js";
import { serviceKey } from "../../core/services.js";
import { errorBody } from "../../server/errors.js";
import { AuthStore, INVITES_SQL, SESSION_DAYS, SQL, type UserInfo } from "./store.js";
import { Throttle } from "./throttle.js";

// Login (docs/plans/self-hosting.md, section 2): accounts with three roles, the web page's sign-in
// cookie, API tokens for the CLI, scripts and agents, and the one-time setup code for the first
// admin. The tables are always there, so `watchwright users add` works before login is turned on;
// requests are only checked when the server starts with login on (`serve --auth`).

export const AUTH_STORE = serviceKey<AuthStore>("auth-store");

export const COOKIE = "ww_session";

/** The cookie's value from a Cookie header, or null. */
export function cookieValue(header: string | undefined, name = COOKIE): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim()) || null;
  }
  return null;
}

/** The token from `Authorization: Bearer <token>`, or null. */
export function bearer(header: string | undefined): string | null {
  const m = header?.match(/^Bearer\s+(\S+)\s*$/i);
  return m ? m[1]! : null;
}

function sessionCookie(value: string, secure: boolean, maxAgeS: number): string {
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeS}${secure ? "; Secure" : ""}`;
}

const isHttps = (req: FastifyRequest) => req.protocol === "https";

const userOut = (u: UserInfo) => ({ id: u.id, name: u.name, displayName: u.displayName, role: u.role });

const ID = { type: "string", pattern: "^[0-9a-f]{12}$" } as const;
const ROLE = { type: "string", enum: ROLES } as const;

/** The signed-in person a call comes from; refuses calls with nobody (login off and not signed in). */
function me(call: ActionCall): CallUser {
  if (!call.user) throw new ActionError("sign_in_needed", "This is about the signed-in person, and nobody is signed in (login is off on this server).", 400);
  return call.user;
}

interface State {
  store: AuthStore;
  throttle: Throttle;
  setupCode: string | null;
  sweep: NodeJS.Timeout | null;
}
const states = new WeakMap<object, State>();

export const authPlugin = definePlugin({
  name: "auth",
  migrations: [
    { id: 1, name: "init", sql: SQL },
    { id: 2, name: "invites", sql: INVITES_SQL },
  ],
  setup(ctx) {
    const store = new AuthStore(ctx.store.db);
    const options = ctx.services.get(LOGIN_OPTIONS);
    const state: State = { store, throttle: new Throttle(), setupCode: null, sweep: null };
    if (options.on) {
      store.sweep();
      state.sweep = setInterval(() => store.sweep(), 24 * 60 * 60_000);
      state.sweep.unref();
      if (store.count() === 0) state.setupCode = randomBytes(12).toString("base64url");
    }
    states.set(ctx, state);
    ctx.services.provide(AUTH_STORE, store);
    const login: Login = {
      on: options.on,
      identify(headers: CredentialHeaders): CallUser | null {
        const token = bearer(headers.authorization);
        if (token) return store.byToken(token);
        const cookie = cookieValue(headers.cookie);
        return cookie ? store.session(cookie) : null;
      },
      setupCode: () => state.setupCode,
    };
    ctx.services.provide(LOGIN, login);
  },
  close(ctx) {
    const s = states.get(ctx);
    if (s?.sweep) clearInterval(s.sweep);
  },
  actions: (ctx) => {
    const store = ctx.services.get(AUTH_STORE);
    return [
      defineAction({
        name: "auth.me",
        title: "Who is signed in, and whether login is on",
        method: "GET",
        path: "/auth/me",
        access: "public",
        handler: (_input, call) => {
          const login = ctx.services.get(LOGIN);
          const user = call.user ? store.user(call.user.id) : null;
          return { on: login.on, user: user ? { ...userOut(user), via: call.user!.via, ...(call.user!.tokenId ? { tokenId: call.user!.tokenId } : {}) } : null, setupNeeded: login.on && login.setupCode() !== null };
        },
      }),
      defineAction({
        name: "auth.users",
        title: "Every user with their role, how they sign in and when they were last seen",
        method: "GET",
        path: "/auth/users",
        access: "admin",
        handler: () => store.users(),
      }),
      defineAction<{ name: string; password?: string; role: Role; displayName?: string }>({
        name: "auth.add-user",
        title: "Add a user with a role (admin, user or viewer) and a password",
        method: "POST",
        path: "/auth/users",
        status: 201,
        access: "admin",
        secret: ["password"],
        input: {
          type: "object",
          properties: { name: { type: "string" }, password: { type: "string" }, role: ROLE, displayName: { type: "string" } },
          required: ["name", "role"],
        },
        handler: (input) => store.add(input),
      }),
      defineAction<{ id: string; role?: Role; password?: string; disabled?: boolean; displayName?: string }>({
        name: "auth.change-user",
        title: "Change a user's role, password, name shown or whether they can sign in",
        method: "POST",
        path: "/auth/users/:id",
        access: "admin",
        secret: ["password"],
        input: {
          type: "object",
          properties: { id: ID, role: ROLE, password: { type: "string" }, disabled: { type: "boolean" }, displayName: { type: "string", description: "Empty to show the user name" } },
          required: ["id"],
        },
        handler: async ({ id, ...change }) => {
          const user = await store.update(id, change);
          if (change.password !== undefined) store.endSessions(id);
          return user;
        },
      }),
      defineAction<{ id: string }>({
        name: "auth.remove-user",
        title: "Remove a user with their sign-ins and tokens",
        method: "DELETE",
        path: "/auth/users/:id",
        access: "admin",
        destructive: true,
        explain: ({ id }) => `Remove the user ${store.user(id)?.name ?? id}, with their sign-ins and tokens.`,
        input: { type: "object", properties: { id: ID }, required: ["id"] },
        handler: ({ id }, call) => {
          if (call.user?.id === id) throw new ActionError("not_allowed", "You can't remove yourself.", 409);
          if (!store.remove(id)) throw new ActionError("not_found", `No user with id ${id}.`, 404);
          return { removed: id };
        },
      }),
      defineAction({
        name: "auth.invites",
        title: "Invitations nobody has used yet",
        method: "GET",
        path: "/auth/invites",
        access: "admin",
        handler: () => store.invites(),
      }),
      defineAction<{ role: Role; days?: number; note?: string }>({
        name: "auth.add-invite",
        title: "Make a one-time link that lets someone make their own account with this role",
        method: "POST",
        path: "/auth/invites",
        status: 201,
        access: "admin",
        input: {
          type: "object",
          properties: { role: ROLE, days: { type: "integer", minimum: 1, maximum: 30, default: 7 }, note: { type: "string", description: "Who it is for, to tell invitations apart" } },
          required: ["role"],
        },
        handler: ({ role, days, note }, call) => {
          const { code, info } = store.addInvite(role, { days, note, by: call.user?.name });
          return { code, ...info };
        },
      }),
      defineAction<{ id: string }>({
        name: "auth.remove-invite",
        title: "Take back an invitation",
        method: "DELETE",
        path: "/auth/invites/:id",
        access: "admin",
        input: { type: "object", properties: { id: ID }, required: ["id"] },
        handler: ({ id }) => {
          if (!store.removeInvite(id)) throw new ActionError("not_found", `No invitation with id ${id}.`, 404);
          return { removed: id };
        },
      }),
      defineAction<{ all?: boolean }>({
        name: "auth.tokens",
        title: "Your API tokens (an admin can list everyone's with all)",
        method: "GET",
        path: "/auth/tokens",
        access: "viewer",
        input: { type: "object", properties: { all: { type: "boolean" } } },
        handler: ({ all }, call) => {
          const u = me(call);
          if (all && u.role !== "admin") throw new ActionError("not_allowed", "Only an admin can list everyone's tokens.", 403);
          return store.tokens(all ? undefined : u.id);
        },
      }),
      defineAction<{ name: string; days?: number }>({
        name: "auth.add-token",
        title: "Make an API token for the CLI, a script or an agent; it is shown this once",
        method: "POST",
        path: "/auth/tokens",
        status: 201,
        access: "viewer",
        input: { type: "object", properties: { name: { type: "string" }, days: { type: "integer", minimum: 1, maximum: 3650 } }, required: ["name"] },
        handler: ({ name, days }, call) => {
          const u = me(call);
          const { token, info } = store.addToken(u.id, name, { days });
          return { token, ...info };
        },
      }),
      defineAction<{ id: string }>({
        name: "auth.remove-token",
        title: "Remove an API token: whatever uses it can't call any more",
        method: "DELETE",
        path: "/auth/tokens/:id",
        access: "viewer",
        input: { type: "object", properties: { id: ID }, required: ["id"] },
        handler: ({ id }, call) => {
          const u = me(call);
          const t = store.token(id);
          if (!t || (t.userId !== u.id && u.role !== "admin")) throw new ActionError("not_found", `No token with id ${id}.`, 404);
          store.removeToken(id);
          return { removed: id };
        },
      }),
    ];
  },
  routes(app, ctx) {
    const state = states.get(ctx)!;
    const { store, throttle } = state;
    const on = ctx.services.get(LOGIN_OPTIONS).on;
    const signedIn = (req: FastifyRequest, reply: FastifyReply, user: UserInfo) => {
      const raw = store.startSession(user.id, req.headers["user-agent"]);
      reply.header("set-cookie", sessionCookie(raw, isHttps(req), SESSION_DAYS * 24 * 60 * 60));
      return { data: { user: userOut(user) } };
    };

    app.post<{ Body: { name?: unknown; password?: unknown } }>("/auth/signin", { config: { access: "public" } }, async (req, reply) => {
      if (!on) return reply.code(409).send(errorBody("login_off", "Login is off on this server; there's nothing to sign in to."));
      const { name, password } = req.body ?? {};
      if (typeof name !== "string" || typeof password !== "string" || !name.trim()) return reply.code(400).send(errorBody("bad_input", "Send { name, password }."));
      const keys = [`name:${name.trim().toLowerCase()}`, `ip:${req.ip}`];
      const wait = throttle.waitMs(keys);
      if (wait > 0) {
        reply.header("retry-after", Math.ceil(wait / 1000));
        return reply.code(429).send(errorBody("too_many_tries", `Too many wrong sign-ins. Try again in ${Math.ceil(wait / 1000)} seconds.`));
      }
      const user = await store.signIn(name, password);
      if (!user) {
        throttle.failed(keys);
        ctx.events.append("auth.signin-failed", { name: name.trim().slice(0, 64), ip: req.ip });
        return reply.code(401).send(errorBody("wrong_sign_in", "That name and password don't match an account that can sign in."));
      }
      throttle.cleared(keys);
      ctx.events.append("auth.signed-in", { user: user.name, ip: req.ip });
      return signedIn(req, reply, user);
    });

    // A route rather than an action: it keeps the session that makes the change and ends the others.
    app.post<{ Body: { current?: unknown; password?: unknown } }>("/auth/password", { config: { access: "viewer" } }, async (req, reply) => {
      const u = req.watchwrightUser;
      if (!u) return reply.code(400).send(errorBody("sign_in_needed", "This changes the signed-in person's password, and nobody is signed in (login is off on this server)."));
      const { current, password } = req.body ?? {};
      if (typeof password !== "string") return reply.code(400).send(errorBody("bad_input", "Send { current, password }."));
      const user = store.user(u.id)!;
      const keys = [`name:${user.name.toLowerCase()}`, `ip:${req.ip}`];
      const wait = throttle.waitMs(keys);
      if (wait > 0) return reply.code(429).header("retry-after", Math.ceil(wait / 1000)).send(errorBody("too_many_tries", `Too many wrong passwords. Try again in ${Math.ceil(wait / 1000)} seconds.`));
      if (user.hasPassword && !(typeof current === "string" && (await store.signIn(user.name, current)))) {
        throttle.failed(keys);
        return reply.code(403).send(errorBody("wrong_password", "Your current password isn't right."));
      }
      try {
        await store.update(u.id, { password });
      } catch (err) {
        if (err instanceof ActionError) return reply.code(err.status).send(errorBody(err.code, err.message));
        throw err;
      }
      store.endSessions(u.id, u.via === "session" ? (cookieValue(req.headers.cookie) ?? undefined) : undefined);
      return { data: { changed: true } };
    });

    // What an invitation link is for, so the page can say so before anyone types.
    app.get<{ Querystring: { code?: string } }>("/auth/invite", { config: { access: "public" } }, async (req, reply) => {
      const inv = typeof req.query.code === "string" ? store.invite(req.query.code) : null;
      if (!inv) return reply.code(404).send(errorBody("bad_invite", "This invitation link isn't valid any more. Ask an admin for a new one."));
      return { data: { role: inv.role, expiresAt: inv.expiresAt } };
    });

    app.post<{ Body: { code?: unknown; name?: unknown; password?: unknown } }>("/auth/invite", { config: { access: "public" } }, async (req, reply) => {
      if (!on) return reply.code(409).send(errorBody("login_off", "Login is off on this server."));
      const { code, name, password } = req.body ?? {};
      const keys = [`ip:${req.ip}`, "invite"];
      const wait = throttle.waitMs(keys);
      if (wait > 0) return reply.code(429).header("retry-after", Math.ceil(wait / 1000)).send(errorBody("too_many_tries", `Too many tries. Try again in ${Math.ceil(wait / 1000)} seconds.`));
      if (typeof code !== "string" || typeof name !== "string" || typeof password !== "string") return reply.code(400).send(errorBody("bad_input", "Send { code, name, password }."));
      try {
        const user = await store.acceptInvite(code, name, password);
        if (!user) {
          throttle.failed(keys);
          return reply.code(404).send(errorBody("bad_invite", "This invitation link isn't valid any more. Ask an admin for a new one."));
        }
        ctx.events.append("auth.invite-used", { user: user.name, role: user.role });
        return signedIn(req, reply, user);
      } catch (err) {
        if (err instanceof ActionError) return reply.code(err.status).send(errorBody(err.code, err.message));
        throw err;
      }
    });

    app.post("/auth/signout", { config: { access: "public" } }, async (req, reply) => {
      const raw = cookieValue(req.headers.cookie);
      if (raw) store.endSession(raw);
      reply.header("set-cookie", sessionCookie("", isHttps(req), 0));
      return { data: { signedOut: true } };
    });

    app.post<{ Body: { code?: unknown; name?: unknown; password?: unknown } }>("/auth/setup", { config: { access: "public" } }, async (req, reply) => {
      const { code, name, password } = req.body ?? {};
      const want = state.setupCode;
      if (!want || store.count() > 0) return reply.code(409).send(errorBody("set_up", "This server already has users. Sign in instead."));
      const keys = [`ip:${req.ip}`, "setup"];
      const wait = throttle.waitMs(keys);
      if (wait > 0) return reply.code(429).header("retry-after", Math.ceil(wait / 1000)).send(errorBody("too_many_tries", `Too many wrong codes. Try again in ${Math.ceil(wait / 1000)} seconds.`));
      if (typeof code !== "string" || !sameText(code, want)) {
        throttle.failed(keys);
        return reply.code(403).send(errorBody("wrong_code", "That setup code isn't right. It is in the server's log, in the line with the setup link."));
      }
      if (typeof name !== "string" || typeof password !== "string") return reply.code(400).send(errorBody("bad_input", "Send { code, name, password }."));
      try {
        const user = await store.add({ name, password, role: "admin" });
        state.setupCode = null;
        ctx.events.append("auth.set-up", { user: user.name });
        return signedIn(req, reply, user);
      } catch (err) {
        if (err instanceof ActionError) return reply.code(err.status).send(errorBody(err.code, err.message));
        throw err;
      }
    });
  },
});

function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
