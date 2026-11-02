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
  /** Has a password (local sign-in works). */
  hasPassword: boolean;
  createdAt: string;
  seenAt: string | null;
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
  created_at: string;
  seen_at: string | null;
}

const toUser = (r: UserRow): UserInfo => ({
  id: r.id,
  name: r.name,
  displayName: r.display_name,
  role: r.role as Role,
  source: r.source as UserInfo["source"],
  disabled: r.disabled === 1,
  hasPassword: r.password !== null,
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
    return (this.db.prepare("SELECT * FROM users ORDER BY name COLLATE NOCASE").all() as UserRow[]).map(toUser);
  }

  user(id: string): UserInfo | null {
    const r = this.db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
    return r ? toUser(r) : null;
  }

  byName(name: string): UserInfo | null {
    const r = this.db.prepare("SELECT * FROM users WHERE name = ? COLLATE NOCASE").get(name) as UserRow | undefined;
    return r ? toUser(r) : null;
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

  async update(id: string, change: { role?: Role | undefined; password?: string | undefined; disabled?: boolean | undefined; displayName?: string | null | undefined }): Promise<UserInfo> {
    const user = this.user(id);
    if (!user) throw new ActionError("not_found", `No user with id ${id}.`, 404);
    const demotes = (change.role !== undefined && change.role !== "admin") || change.disabled === true;
    if (user.role === "admin" && !user.disabled && demotes && this.admins() <= 1) throw new ActionError("last_admin", "This is the only admin. Make another admin first.", 409);
    if (change.role !== undefined) {
      if (!ROLES.includes(change.role)) throw new ActionError("bad_input", `A role is one of ${ROLES.join(", ")}.`);
      this.db.prepare("UPDATE users SET role = ? WHERE id = ?").run(change.role, id);
    }
    if (change.displayName !== undefined) this.db.prepare("UPDATE users SET display_name = ? WHERE id = ?").run(change.displayName?.trim() || null, id);
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
      .prepare("SELECT s.used_at, s.expires_at, u.id, u.name, u.role, u.disabled FROM auth_sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?")
      .get(id) as { used_at: string; expires_at: string; id: string; name: string; role: string; disabled: number } | undefined;
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
    return { id: row.id, name: row.name, role: row.role as Role, via: "session" };
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
      .prepare("SELECT t.id AS token_id, t.kind, t.used_at, t.expires_at, u.id, u.name, u.role, u.disabled FROM auth_tokens t JOIN users u ON u.id = t.user_id WHERE t.hash = ?")
      .get(sha256(raw)) as { token_id: string; kind: string; used_at: string | null; expires_at: string | null; id: string; name: string; role: string; disabled: number } | undefined;
    if (!row || row.disabled === 1 || row.kind !== "api") return null;
    const now = Date.now();
    if (row.expires_at && Date.parse(row.expires_at) <= now) return null;
    if (!row.used_at || now - Date.parse(row.used_at) > TOUCH_MS) {
      const iso = new Date(now).toISOString();
      this.db.prepare("UPDATE auth_tokens SET used_at = ? WHERE id = ?").run(iso, row.token_id);
      this.db.prepare("UPDATE users SET seen_at = ? WHERE id = ?").run(iso, row.id);
    }
    return { id: row.id, name: row.name, role: row.role as Role, via: "token", tokenId: row.token_id };
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
