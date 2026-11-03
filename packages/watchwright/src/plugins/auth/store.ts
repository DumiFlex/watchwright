import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";
import type Database from "better-sqlite3";
import { ActionError } from "../../actions/registry.js";
import { ROLES, type CallUser, type Role } from "../../core/access.js";

// Accounts, sign-in sessions and API tokens (docs/plans/self-hosting.md, section 2.3). Passwords
// are hashed with scrypt; session ids and tokens are random and only their SHA-256 is stored, so
// a copy of the database doesn't let anyone sign in.

export const SQL = `
  CREATE TABLE users (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name  TEXT,
    role          TEXT NOT NULL,
    password      TEXT,
    source        TEXT NOT NULL DEFAULT 'local',
    subject       TEXT,
    disabled      INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL,
    seen_at       TEXT
  );
  CREATE TABLE auth_sessions (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at  TEXT NOT NULL,
    used_at     TEXT NOT NULL,
    expires_at  TEXT NOT NULL,
    agent       TEXT
  );
  CREATE INDEX auth_sessions_user ON auth_sessions (user_id);
  CREATE TABLE auth_tokens (
    id          TEXT PRIMARY KEY,
    hash        TEXT NOT NULL UNIQUE,
    user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    kind        TEXT NOT NULL DEFAULT 'api',
    created_at  TEXT NOT NULL,
    used_at     TEXT,
    expires_at  TEXT
  );
  CREATE INDEX auth_tokens_user ON auth_tokens (user_id);
`;

/** Invitations: a one-time link that lets someone make their own account with a set role. */
export const INVITES_SQL = `
  CREATE TABLE auth_invites (
    id          TEXT PRIMARY KEY,
    hash        TEXT NOT NULL UNIQUE,
    role        TEXT NOT NULL,
    note        TEXT,
    created_by  TEXT,
    created_at  TEXT NOT NULL,
    expires_at  TEXT NOT NULL
  );
`;

/** Single sign-on: its settings, and accounts found by provider + subject. */
export const SSO_SQL = `
  CREATE TABLE auth_config (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
  );
  CREATE UNIQUE INDEX users_subject ON users (source, subject) WHERE subject IS NOT NULL;
`;

/** Migration 4: groups for pack access, set by an admin (`groups`) or sent by the sign-in provider at each sign-in (`sso_groups`). */
export const GROUPS_SQL = `
  ALTER TABLE users ADD COLUMN groups TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE users ADD COLUMN sso_groups TEXT NOT NULL DEFAULT '[]';
`;

/**
 * Migration 5: the sign-ins linked to an account, so one account can have a password, an OpenID
 * Connect identity and a header name (docs/research/sso-account-linking.md). The pair each account
 * had moves here; `users.source` stays as how the account was first made.
 */
export const IDENTITIES_SQL = `
  CREATE TABLE auth_identities (
    id          TEXT PRIMARY KEY,
    source      TEXT NOT NULL,
    subject     TEXT NOT NULL,
    user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name        TEXT,
    created_at  TEXT NOT NULL,
    used_at     TEXT
  );
  CREATE UNIQUE INDEX auth_identities_subject ON auth_identities (source, subject);
  CREATE INDEX auth_identities_user ON auth_identities (user_id);
  INSERT INTO auth_identities (id, source, subject, user_id, name, created_at, used_at)
    SELECT lower(hex(randomblob(6))), source, subject, id, name, created_at, seen_at FROM users WHERE subject IS NOT NULL AND source IN ('oidc', 'header');
  DROP INDEX users_subject;
  UPDATE users SET subject = NULL;
`;

/** A group name as kept: trimmed, at most 200 characters; empty ones and repeats (ignoring case) go. */
export function cleanGroups(list: readonly string[]): string[] {
  const out = new Map<string, string>();
  for (const g of list) {
    const t = g.trim().slice(0, 200);
    if (t && !out.has(t.toLowerCase())) out.set(t.toLowerCase(), t);
  }
  return [...out.values()].sort((a, b) => a.localeCompare(b));
}

const groupsOfRow = (r: { groups?: string; sso_groups?: string }): string[] => cleanGroups([...(JSON.parse(r.groups ?? "[]") as string[]), ...(JSON.parse(r.sso_groups ?? "[]") as string[])]);

export interface InviteInfo {
  id: string;
  role: Role;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
  expiresAt: string;
}

const INVITE_PREFIX = "inv_";

/** A session lasts this long after its last use. */
export const SESSION_DAYS = 30;
const DAY_MS = 24 * 60 * 60_000;
/** Writing "last used" on every request would write on every request; once a minute is enough. */
const TOUCH_MS = 60_000;

export const USER_NAME = /^[A-Za-z0-9][A-Za-z0-9._@-]{0,63}$/;
export const MIN_PASSWORD = 10;
const TOKEN_PREFIX = "ww_";

export interface UserInfo {
  id: string;
  name: string;
  displayName: string | null;
  role: Role;
  source: "local" | "oidc" | "header";
  disabled: boolean;
  /** Groups an admin put the user in, for pack access. */
  groups: string[];
  /** Groups the sign-in provider (or proxy) said the user is in, at their last sign-in. */
  ssoGroups: string[];
  /** Has a password (local sign-in works). */
  hasPassword: boolean;
  /** Single sign-on identities linked to the account. */
  signins: SignInInfo[];
  createdAt: string;
  seenAt: string | null;
}

/** A single sign-on identity linked to an account (the subject itself isn't answered). */
export interface SignInInfo {
  id: string;
  source: "oidc" | "header";
  /** What the provider calls the person, such as their user name there. */
  name: string | null;
  createdAt: string;
  usedAt: string | null;
}

interface IdentityRow {
  id: string;
  source: string;
  subject: string;
  user_id: string;
  name: string | null;
  created_at: string;
  used_at: string | null;
}

const toSignIn = (r: IdentityRow): SignInInfo => ({ id: r.id, source: r.source as SignInInfo["source"], name: r.name, createdAt: r.created_at, usedAt: r.used_at });

/** An account name from what a provider calls someone: fit for a user name (not yet unique). */
export function accountName(wanted: string): string {
  return (wanted.replace(/[^A-Za-z0-9._@-]+/g, "-").replace(/^[^A-Za-z0-9]+/, "").slice(0, 60) || "user").replace(/-+$/, "") || "user";
}

export interface TokenInfo {
  id: string;
  name: string;
  userId: string;
  userName: string;
  kind: "api" | "runner";
  createdAt: string;
  usedAt: string | null;
  expiresAt: string | null;
}

interface UserRow {
  id: string;
  name: string;
  display_name: string | null;
  role: string;
  password: string | null;
  source: string;
  disabled: number;
  groups: string;
  sso_groups: string;
  created_at: string;
  seen_at: string | null;
}

const toUser = (r: UserRow, signins: SignInInfo[] = []): UserInfo => ({
  id: r.id,
  name: r.name,
  displayName: r.display_name,
  role: r.role as Role,
  source: r.source as UserInfo["source"],
  disabled: r.disabled === 1,
  groups: cleanGroups(JSON.parse(r.groups ?? "[]") as string[]),
  ssoGroups: cleanGroups(JSON.parse(r.sso_groups ?? "[]") as string[]),
  hasPassword: r.password !== null,
  signins,
  createdAt: r.created_at,
  seenAt: r.seen_at,
});

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const scrypt = (password: string, salt: Buffer, keylen: number, opts: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) => scryptCb(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))));

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/** `scrypt$N$r$p$salt$hash`, salt and hash in base64url. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function checkPassword(password: string, stored: string): Promise<boolean> {
  const [kind, n, r, p, salt, hash] = stored.split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const want = Buffer.from(hash, "base64url");
  const got = await scrypt(password, Buffer.from(salt, "base64url"), want.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem });
  return got.length === want.length && timingSafeEqual(got, want);
}

/** A stored hash to compare against when the name is unknown, so a wrong name takes as long as a wrong password. */
let dummyHash: Promise<string> | null = null;

export class AuthStore {
  constructor(private readonly db: Database.Database) {}

  count(): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
  }

  users(): UserInfo[] {
    const ids = new Map<string, SignInInfo[]>();
    for (const r of this.db.prepare("SELECT * FROM auth_identities ORDER BY created_at").all() as IdentityRow[]) ids.set(r.user_id, [...(ids.get(r.user_id) ?? []), toSignIn(r)]);
    return (this.db.prepare("SELECT * FROM users ORDER BY name COLLATE NOCASE").all() as UserRow[]).map((r) => toUser(r, ids.get(r.id)));
  }

  user(id: string): UserInfo | null {
    const r = this.db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
    return r ? toUser(r, this.signins(r.id)) : null;
  }

  byName(name: string): UserInfo | null {
    const r = this.db.prepare("SELECT * FROM users WHERE name = ? COLLATE NOCASE").get(name) as UserRow | undefined;
    return r ? toUser(r, this.signins(r.id)) : null;
  }

  /** The single sign-on identities linked to an account. */
  signins(userId: string): SignInInfo[] {
    return (this.db.prepare("SELECT * FROM auth_identities WHERE user_id = ? ORDER BY created_at").all(userId) as IdentityRow[]).map(toSignIn);
  }

  /** A linked identity by its id, with the account it belongs to. */
  signin(id: string): (SignInInfo & { userId: string }) | null {
    const r = this.db.prepare("SELECT * FROM auth_identities WHERE id = ?").get(id) as IdentityRow | undefined;
    return r ? { ...toSignIn(r), userId: r.user_id } : null;
  }

  /**
   * Links an identity the provider vouched for to an account. Already linked to it: refreshed.
   * Linked to another account: refused, since only an admin may move it (`merge`).
   */
  link(userId: string, source: "oidc" | "header", subject: string, name: string | null): SignInInfo {
    const user = this.user(userId);
    if (!user) throw new ActionError("not_found", `No user with id ${userId}.`, 404);
    const now = new Date().toISOString();
    const found = this.db.prepare("SELECT * FROM auth_identities WHERE source = ? AND subject = ?").get(source, subject) as IdentityRow | undefined;
    if (found && found.user_id !== userId) {
      const other = this.user(found.user_id);
      throw new ActionError("linked_elsewhere", `This sign-in is already linked to the account ${other?.name ?? found.user_id}. An admin can merge that account into yours in Admin › Users.`, 409);
    }
    if (found) {
      this.db.prepare("UPDATE auth_identities SET used_at = ?, name = COALESCE(?, name) WHERE id = ?").run(now, name, found.id);
      return toSignIn({ ...found, used_at: now, name: name ?? found.name });
    }
    const id = randomBytes(6).toString("hex");
    this.db.prepare("INSERT INTO auth_identities (id, source, subject, user_id, name, created_at, used_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, source, subject, userId, name?.slice(0, 120) ?? null, now, now);
    return this.signin(id)!;
  }

  /** Unlinks an identity, unless it is the account's only way in. */
  unlink(id: string): boolean {
    const s = this.signin(id);
    if (!s) return false;
    const user = this.user(s.userId)!;
    if (!user.hasPassword && user.signins.length <= 1)
      throw new ActionError("last_sign_in", "This is the only way this account signs in. Set a password or link another sign-in first.", 409);
    return this.db.prepare("DELETE FROM auth_identities WHERE id = ?").run(id).changes > 0;
  }

  /**
   * Merges one account into another: its linked sign-ins and API tokens move to `into`, then it is
   * removed (with its sessions). Runs and reviews keep the name they were made under.
   */
  merge(fromId: string, intoId: string): { moved: { signins: number; tokens: number }; into: UserInfo } {
    if (fromId === intoId) throw new ActionError("bad_input", "Pick two different accounts.");
    const from = this.user(fromId);
    const into = this.user(intoId);
    if (!from) throw new ActionError("not_found", `No user with id ${fromId}.`, 404);
    if (!into) throw new ActionError("not_found", `No user with id ${intoId}.`, 404);
    if (from.role === "admin" && !from.disabled && (into.role !== "admin" || into.disabled) && this.admins() <= 1)
      throw new ActionError("last_admin", `${from.name} is the only admin. Make ${into.name} an admin first.`, 409);
    return this.db.transaction(() => {
      const signins = this.db.prepare("UPDATE auth_identities SET user_id = ? WHERE user_id = ?").run(intoId, fromId).changes;
      const tokens = this.db.prepare("UPDATE auth_tokens SET user_id = ? WHERE user_id = ?").run(intoId, fromId).changes;
      this.db.prepare("DELETE FROM users WHERE id = ?").run(fromId);
      return { moved: { signins, tokens }, into: this.user(intoId)! };
    })();
  }

  private admins(): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0").get() as { n: number }).n;
  }

  async add(input: { name: string; password?: string | undefined; role: Role; displayName?: string | undefined }): Promise<UserInfo> {
    const name = input.name.trim();
    if (!USER_NAME.test(name)) throw new ActionError("bad_input", `A user name is letters, digits and . _ @ -, starting with a letter or digit (up to 64): "${name}" isn't.`);
    if (!ROLES.includes(input.role)) throw new ActionError("bad_input", `A role is one of ${ROLES.join(", ")}.`);
    if (this.byName(name)) throw new ActionError("name_taken", `There is already a user named ${name}.`, 409);
    if (input.password !== undefined) checkNewPassword(input.password);
    const id = randomBytes(6).toString("hex");
    const hash = input.password === undefined ? null : await hashPassword(input.password);
    this.db
      .prepare("INSERT INTO users (id, name, display_name, role, password, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, name, input.displayName?.trim() || null, input.role, hash, new Date().toISOString());
    return this.user(id)!;
  }

  async update(id: string, change: { role?: Role | undefined; password?: string | undefined; disabled?: boolean | undefined; displayName?: string | null | undefined; groups?: string[] | undefined }): Promise<UserInfo> {
    const user = this.user(id);
    if (!user) throw new ActionError("not_found", `No user with id ${id}.`, 404);
    const demotes = (change.role !== undefined && change.role !== "admin") || change.disabled === true;
    if (user.role === "admin" && !user.disabled && demotes && this.admins() <= 1) throw new ActionError("last_admin", "This is the only admin. Make another admin first.", 409);
    if (change.role !== undefined) {
      if (!ROLES.includes(change.role)) throw new ActionError("bad_input", `A role is one of ${ROLES.join(", ")}.`);
      this.db.prepare("UPDATE users SET role = ? WHERE id = ?").run(change.role, id);
    }
    if (change.displayName !== undefined) this.db.prepare("UPDATE users SET display_name = ? WHERE id = ?").run(change.displayName?.trim() || null, id);
    if (change.groups !== undefined) this.db.prepare("UPDATE users SET groups = ? WHERE id = ?").run(JSON.stringify(cleanGroups(change.groups)), id);
    if (change.password !== undefined) {
      checkNewPassword(change.password);
      this.db.prepare("UPDATE users SET password = ? WHERE id = ?").run(await hashPassword(change.password), id);
    }
    if (change.disabled !== undefined) {
      this.db.prepare("UPDATE users SET disabled = ? WHERE id = ?").run(change.disabled ? 1 : 0, id);
      if (change.disabled) this.endSessions(id);
    }
    return this.user(id)!;
  }

  remove(id: string): boolean {
    const user = this.user(id);
    if (!user) return false;
    if (user.role === "admin" && !user.disabled && this.admins() <= 1) throw new ActionError("last_admin", "This is the only admin. Make another admin first.", 409);
    return this.db.prepare("DELETE FROM users WHERE id = ?").run(id).changes > 0;
  }

  /** The account a provider (or proxy) knows by this subject, or null. */
  bySubject(source: "oidc" | "header", subject: string): UserInfo | null {
    const r = this.db.prepare("SELECT u.* FROM auth_identities i JOIN users u ON u.id = i.user_id WHERE i.source = ? AND i.subject = ?").get(source, subject) as UserRow | undefined;
    return r ? toUser(r, this.signins(r.id)) : null;
  }

  /** A stored setting (JSON), or null. */
  config<T>(key: string): T | null {
    const r = this.db.prepare("SELECT value FROM auth_config WHERE key = ?").get(key) as { value: string } | undefined;
    return r ? (JSON.parse(r.value) as T) : null;
  }

  setConfig(key: string, value: unknown): void {
    this.db.prepare("INSERT INTO auth_config (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(key, JSON.stringify(value));
  }

  /**
   * The account of someone a sign-in provider (or a trusted proxy) vouches for, found by source and
   * subject. `role` is what the provider's groups give them: it is set on the account when given
   * (except that the last admin stays one), and a new account needs one. Null: no account and no
   * role, or the account is disabled.
   */
  external(source: "oidc" | "header", subject: string, wanted: { name: string; displayName?: string | null | undefined; groups?: readonly string[] | undefined }, role: Role | null): UserInfo | null {
    const r = this.db.prepare("SELECT u.* FROM auth_identities i JOIN users u ON u.id = i.user_id WHERE i.source = ? AND i.subject = ?").get(source, subject) as UserRow | undefined;
    const now = new Date().toISOString();
    const ssoGroups = JSON.stringify(cleanGroups(wanted.groups ?? []));
    if (r) {
      if (r.disabled === 1) return null;
      if (ssoGroups !== r.sso_groups) this.db.prepare("UPDATE users SET sso_groups = ? WHERE id = ?").run(ssoGroups, r.id);
      const lastAdmin = r.role === "admin" && this.admins() <= 1;
      if (role && role !== r.role && !(lastAdmin && role !== "admin")) this.db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, r.id);
      if (wanted.displayName && wanted.displayName !== r.display_name) this.db.prepare("UPDATE users SET display_name = ? WHERE id = ?").run(wanted.displayName.slice(0, 120), r.id);
      this.db.prepare("UPDATE users SET seen_at = ? WHERE id = ?").run(now, r.id);
      this.db.prepare("UPDATE auth_identities SET used_at = ?, name = ? WHERE source = ? AND subject = ?").run(now, wanted.name.slice(0, 120), source, subject);
      return this.user(r.id);
    }
    if (!role) return null;
    // A name for the account: what the provider calls them, made fit for a user name, unique.
    const base = accountName(wanted.name);
    let name = base;
    for (let i = 2; this.byName(name); i++) name = `${base}-${i}`;
    const id = randomBytes(6).toString("hex");
    this.db.transaction(() => {
      this.db
        .prepare("INSERT INTO users (id, name, display_name, role, password, source, sso_groups, created_at, seen_at) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)")
        .run(id, name, wanted.displayName?.slice(0, 120) || null, role, source, ssoGroups, now, now);
      this.db.prepare("INSERT INTO auth_identities (id, source, subject, user_id, name, created_at, used_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(randomBytes(6).toString("hex"), source, subject, id, wanted.name.slice(0, 120), now, now);
    })();
    return this.user(id);
  }

  /**
   * The account a new identity would collide with: an enabled account with a password that already
   * has the name the provider gives. Its owner can link the identity by proving the password.
   */
  nameClash(wanted: string): UserInfo | null {
    const u = this.byName(accountName(wanted));
    return u && u.hasPassword && !u.disabled ? u : null;
  }

  /** The user when name and password match an enabled local account; null otherwise. Takes as long either way. */
  async signIn(name: string, password: string): Promise<UserInfo | null> {
    const r = this.db.prepare("SELECT * FROM users WHERE name = ? COLLATE NOCASE").get(name.trim()) as UserRow | undefined;
    if (!r || r.password === null) {
      dummyHash ??= hashPassword("not a password anyone has");
      await checkPassword(password, await dummyHash);
      return null;
    }
    const ok = await checkPassword(password, r.password);
    return ok && r.disabled === 0 ? toUser(r) : null;
  }

  /** A new session for the user: the cookie value (only its hash is kept). */
  startSession(userId: string, agent?: string): string {
    const raw = randomBytes(32).toString("base64url");
    const now = new Date();
    this.db
      .prepare("INSERT INTO auth_sessions (id, user_id, created_at, used_at, expires_at, agent) VALUES (?, ?, ?, ?, ?, ?)")
      .run(sha256(raw), userId, now.toISOString(), now.toISOString(), new Date(now.getTime() + SESSION_DAYS * DAY_MS).toISOString(), agent?.slice(0, 200) ?? null);
    this.db.prepare("UPDATE users SET seen_at = ? WHERE id = ?").run(now.toISOString(), userId);
    return raw;
  }

  endSession(raw: string): void {
    this.db.prepare("DELETE FROM auth_sessions WHERE id = ?").run(sha256(raw));
  }

  /** Ends every session of a user, but `keep` (the one changing its own password). */
  endSessions(userId: string, keep?: string): void {
    if (keep) this.db.prepare("DELETE FROM auth_sessions WHERE user_id = ? AND id <> ?").run(userId, sha256(keep));
    else this.db.prepare("DELETE FROM auth_sessions WHERE user_id = ?").run(userId);
  }

  /** The user a session cookie belongs to, sliding its expiry; null when it isn't valid. */
  session(raw: string): CallUser | null {
    const id = sha256(raw);
    const row = this.db
      .prepare("SELECT s.used_at, s.expires_at, u.id, u.name, u.role, u.disabled, u.groups, u.sso_groups FROM auth_sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?")
      .get(id) as { used_at: string; expires_at: string; id: string; name: string; role: string; disabled: number; groups: string; sso_groups: string } | undefined;
    if (!row || row.disabled === 1) return null;
    const now = Date.now();
    if (Date.parse(row.expires_at) <= now) {
      this.db.prepare("DELETE FROM auth_sessions WHERE id = ?").run(id);
      return null;
    }
    if (now - Date.parse(row.used_at) > TOUCH_MS) {
      const iso = new Date(now).toISOString();
      this.db.prepare("UPDATE auth_sessions SET used_at = ?, expires_at = ? WHERE id = ?").run(iso, new Date(now + SESSION_DAYS * DAY_MS).toISOString(), id);
      this.db.prepare("UPDATE users SET seen_at = ? WHERE id = ?").run(iso, row.id);
    }
    const groups = groupsOfRow(row);
    return { id: row.id, name: row.name, role: row.role as Role, via: "session", ...(groups.length > 0 ? { groups } : {}) };
  }

  tokens(userId?: string): TokenInfo[] {
    const rows = this.db
      .prepare(`SELECT t.*, u.name AS user_name FROM auth_tokens t JOIN users u ON u.id = t.user_id ${userId ? "WHERE t.user_id = ?" : ""} ORDER BY t.created_at DESC`)
      .all(...(userId ? [userId] : [])) as { id: string; name: string; user_id: string; user_name: string; kind: string; created_at: string; used_at: string | null; expires_at: string | null }[];
    return rows.map((r) => ({ id: r.id, name: r.name, userId: r.user_id, userName: r.user_name, kind: r.kind as TokenInfo["kind"], createdAt: r.created_at, usedAt: r.used_at, expiresAt: r.expires_at }));
  }

  /** A new token: `{ token }` is the only time the value is shown. */
  addToken(userId: string, name: string, opts: { kind?: TokenInfo["kind"]; days?: number | undefined } = {}): { token: string; info: TokenInfo } {
    const clean = name.trim().slice(0, 80);
    if (!clean) throw new ActionError("bad_input", "A token needs a name, such as the machine or agent it's for.");
    const raw = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
    const id = randomBytes(6).toString("hex");
    const now = new Date();
    const expires = opts.days ? new Date(now.getTime() + opts.days * DAY_MS).toISOString() : null;
    this.db
      .prepare("INSERT INTO auth_tokens (id, hash, user_id, name, kind, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(id, sha256(raw), userId, clean, opts.kind ?? "api", now.toISOString(), expires);
    return { token: raw, info: this.tokens(userId).find((t) => t.id === id)! };
  }

  token(id: string): TokenInfo | null {
    return this.tokens().find((t) => t.id === id) ?? null;
  }

  removeToken(id: string): boolean {
    return this.db.prepare("DELETE FROM auth_tokens WHERE id = ?").run(id).changes > 0;
  }

  /** The user an API token belongs to; null when it isn't valid. Runner tokens never count here. */
  byToken(raw: string): CallUser | null {
    if (!raw.startsWith(TOKEN_PREFIX)) return null;
    const row = this.db
      .prepare("SELECT t.id AS token_id, t.kind, t.used_at, t.expires_at, u.id, u.name, u.role, u.disabled, u.groups, u.sso_groups FROM auth_tokens t JOIN users u ON u.id = t.user_id WHERE t.hash = ?")
      .get(sha256(raw)) as { token_id: string; kind: string; used_at: string | null; expires_at: string | null; id: string; name: string; role: string; disabled: number; groups: string; sso_groups: string } | undefined;
    if (!row || row.disabled === 1 || row.kind !== "api") return null;
    const now = Date.now();
    if (row.expires_at && Date.parse(row.expires_at) <= now) return null;
    if (!row.used_at || now - Date.parse(row.used_at) > TOUCH_MS) {
      const iso = new Date(now).toISOString();
      this.db.prepare("UPDATE auth_tokens SET used_at = ? WHERE id = ?").run(iso, row.token_id);
      this.db.prepare("UPDATE users SET seen_at = ? WHERE id = ?").run(iso, row.id);
    }
    const groups = groupsOfRow(row);
    return { id: row.id, name: row.name, role: row.role as Role, via: "token", tokenId: row.token_id, ...(groups.length > 0 ? { groups } : {}) };
  }

  invites(): InviteInfo[] {
    const rows = this.db.prepare("SELECT * FROM auth_invites WHERE expires_at > ? ORDER BY created_at DESC").all(new Date().toISOString()) as {
      id: string;
      role: string;
      note: string | null;
      created_by: string | null;
      created_at: string;
      expires_at: string;
    }[];
    return rows.map((r) => ({ id: r.id, role: r.role as Role, note: r.note, createdBy: r.created_by, createdAt: r.created_at, expiresAt: r.expires_at }));
  }

  /** A new invitation: `code` goes in the link and is shown this once. */
  addInvite(role: Role, opts: { days?: number | undefined; note?: string | undefined; by?: string | undefined } = {}): { code: string; info: InviteInfo } {
    if (!ROLES.includes(role)) throw new ActionError("bad_input", `A role is one of ${ROLES.join(", ")}.`);
    const code = `${INVITE_PREFIX}${randomBytes(24).toString("base64url")}`;
    const id = randomBytes(6).toString("hex");
    const now = new Date();
    const expires = new Date(now.getTime() + (opts.days ?? 7) * DAY_MS).toISOString();
    this.db
      .prepare("INSERT INTO auth_invites (id, hash, role, note, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(id, sha256(code), role, opts.note?.trim().slice(0, 120) || null, opts.by ?? null, now.toISOString(), expires);
    return { code, info: this.invites().find((i) => i.id === id)! };
  }

  /** The invitation a code belongs to, while it is valid; null otherwise. */
  invite(code: string): InviteInfo | null {
    if (!code.startsWith(INVITE_PREFIX)) return null;
    const r = this.db.prepare("SELECT id FROM auth_invites WHERE hash = ? AND expires_at > ?").get(sha256(code), new Date().toISOString()) as { id: string } | undefined;
    return r ? (this.invites().find((i) => i.id === r.id) ?? null) : null;
  }

  removeInvite(id: string): boolean {
    return this.db.prepare("DELETE FROM auth_invites WHERE id = ?").run(id).changes > 0;
  }

  /** Makes the account an invitation is for and uses the invitation up; null when the code isn't valid. */
  async acceptInvite(code: string, name: string, password: string): Promise<UserInfo | null> {
    const inv = this.invite(code);
    if (!inv) return null;
    const user = await this.add({ name, password, role: inv.role });
    this.removeInvite(inv.id);
    return user;
  }

  /** Drops sessions and invitations that have expired (on start, and once a day). */
  sweep(): void {
    const now = new Date().toISOString();
    this.db.prepare("DELETE FROM auth_sessions WHERE expires_at <= ?").run(now);
    this.db.prepare("DELETE FROM auth_invites WHERE expires_at <= ?").run(now);
  }
}

export function checkNewPassword(password: string): void {
  if (password.length < MIN_PASSWORD) throw new ActionError("weak_password", `A password needs at least ${MIN_PASSWORD} characters.`);
  if (password.length > 1024) throw new ActionError("bad_input", "That password is longer than 1024 characters.");
}
