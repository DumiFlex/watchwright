// Who may call what, when login is on (docs/plans/self-hosting.md, section 2). With login off,
// every call is allowed, as before. With it on, every action and every route declares an access
// level, and a request is let through only when the person it comes from has that role or a
// higher one. The auth plugin provides the `LOGIN` service that tells who a request comes from.

export const ROLES = ["viewer", "user", "admin"] as const;
export type Role = (typeof ROLES)[number];

/** `public`: anyone, signed in or not. Otherwise the lowest role that may call it. */
export type Access = "public" | Role;
export const ACCESS_LEVELS: readonly Access[] = ["public", ...ROLES];

/** The person a request comes from, and how they proved it. */
export interface CallUser {
  id: string;
  name: string;
  role: Role;
  /** `session`: the web page's sign-in cookie. `token`: an API token (CLI, scripts, agents). */
  via: "session" | "token";
  /** With `via: "token"`: which token, so a client can remove its own. */
  tokenId?: string;
}

/** Headers that can carry who someone is. */
export interface CredentialHeaders {
  cookie?: string | undefined;
  authorization?: string | undefined;
  /** The address the request came from directly (the reverse proxy, when there is one). */
  peer?: string | undefined;
  /** Any other request header, by name; for single sign-on through a header a trusted proxy sets. */
  header?: ((name: string) => string | undefined) | undefined;
}

/** What the auth plugin tells the server and other plugins about login. */
export interface Login {
  /** Login is on: requests need a session or a token, except for `public` routes. */
  readonly on: boolean;
  /** Who these headers belong to, or null (no credentials, or ones that don't hold). */
  identify(headers: CredentialHeaders): CallUser | null;
  /** The one-time code that creates the first admin, while there is no user; null otherwise. */
  setupCode(): string | null;
}

/** How the server was asked to run login, given to plugins before they're set up. */
export interface LoginOptions {
  on: boolean;
  /** Addresses people use to reach the server (`https://watchwright.home.lan`), from --public-url. */
  publicUrls: readonly string[];
}

/** True when `user` may call something with this access level. `undefined` user: login is off, or the server itself calls. */
export function allows(access: Access, user: CallUser | null | undefined): boolean {
  if (user === undefined || access === "public") return true;
  if (user === null) return false;
  return ROLES.indexOf(user.role) >= ROLES.indexOf(access);
}

/** The words for a refused call: sign in first, or a role that's too low. */
export function refusal(access: Access, user: CallUser | null): { status: 401 | 403; code: string; message: string } {
  if (user === null) return { status: 401, code: "sign_in_needed", message: "Sign in first: this server has login on. Scripts and agents send a token as `Authorization: Bearer <token>`." };
  return { status: 403, code: "not_allowed", message: `This needs the ${access} role; ${user.name} is ${user.role === "admin" ? "an" : "a"} ${user.role}.` };
}

/**
 * How a call shows who made it on runs and approvals: the client as before when login is off,
 * the person's name from the web page, "Dumi via Claude Code" from anything else.
 */
export function whoCalls(client: string, user: CallUser | null | undefined): string {
  if (!user) return client;
  return client === "web" || client === "api" ? user.name : `${user.name} via ${client}`;
}

/** An action's access level: its own, else `viewer` for GET and `user` for the rest. */
export function accessOfAction(action: { method: string; access?: Access | undefined }): Access {
  return action.access ?? (action.method === "GET" ? "viewer" : "user");
}
