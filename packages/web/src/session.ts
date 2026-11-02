// Who is signed in, when the server has login on (docs/plans/self-hosting.md, section 2). With
// login off there is no session and every page and button shows as before. With it on, the app
// shows the sign-in page until someone signs in, and hides what the person's role can't do.
import { reactive } from "vue";
import { getJson, onSignedOut, sendJson } from "./api";

export type Role = "viewer" | "user" | "admin";
const ROLES: readonly Role[] = ["viewer", "user", "admin"];

export interface SessionUser {
  id: string;
  name: string;
  displayName: string | null;
  role: Role;
  via: "session" | "token";
}

/** How people sign in here: the single sign-on provider's name (for its button), and whether everyone may use a password. */
export interface SigninWays {
  oidc: string | null;
  passwords: boolean;
}

export const session = reactive<{ loaded: boolean; on: boolean; user: SessionUser | null; setupNeeded: boolean; signin: SigninWays }>({
  loaded: false,
  on: false,
  user: null,
  setupNeeded: false,
  signin: { oidc: null, passwords: true },
});

/** True when the person may do what needs `role`; always true with login off. */
export function can(role: Role): boolean {
  if (!session.on) return true;
  return session.user !== null && ROLES.indexOf(session.user.role) >= ROLES.indexOf(role);
}

export async function loadSession(): Promise<boolean> {
  const res = await getJson<{ on: boolean; user: SessionUser | null; setupNeeded: boolean; signin?: SigninWays }>("/api/v1/auth/me");
  if (!res.ok) return false;
  Object.assign(session, res.data, { loaded: true });
  return true;
}

export async function signIn(name: string, password: string): Promise<string | null> {
  const res = await sendJson("/api/v1/auth/signin", { name, password });
  if (!res.ok) return res.error.message;
  await loadSession();
  return null;
}

export async function setUp(code: string, name: string, password: string): Promise<string | null> {
  const res = await sendJson("/api/v1/auth/setup", { code, name, password });
  if (!res.ok) return res.error.message;
  await loadSession();
  return null;
}

/** What an invitation link is for; an error message when it isn't valid. */
export async function inviteFor(code: string): Promise<{ role: Role; expiresAt: string } | string> {
  const res = await getJson<{ role: Role; expiresAt: string }>(`/api/v1/auth/invite?code=${encodeURIComponent(code)}`);
  return res.ok ? res.data : res.error.message;
}

export async function acceptInvite(code: string, name: string, password: string): Promise<string | null> {
  const res = await sendJson("/api/v1/auth/invite", { code, name, password });
  if (!res.ok) return res.error.message;
  await loadSession();
  return null;
}

export async function signOut(): Promise<void> {
  await sendJson("/api/v1/auth/signout");
  session.user = null;
  // Everything the page holds belongs to the person who signed out.
  location.hash = "#/";
  location.reload();
}

// Any call the server refuses for want of a sign-in (the session ran out) shows the sign-in page.
onSignedOut(() => {
  if (session.on) session.user = null;
});
