import { createHash, randomBytes } from "node:crypto";
import type Database from "better-sqlite3";

// Share links (one run, read-only, for people without an account) and the public dashboard's
// settings (docs/plans/self-hosting.md, section 4). Links are looked up by their hash; the token is
// kept too, so a link can be copied again from the list.

export const SHARES_SQL = `
  CREATE TABLE shares (
    id              TEXT PRIMARY KEY,
    hash            TEXT NOT NULL UNIQUE,
    run_id          TEXT NOT NULL,
    traces          INTEGER NOT NULL DEFAULT 0,
    created_by      TEXT,
    created_at      TEXT NOT NULL,
    expires_at      TEXT,
    views           INTEGER NOT NULL DEFAULT 0,
    viewed_at       TEXT
  );
  CREATE INDEX shares_run ON shares (run_id);
  CREATE TABLE shares_config (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
  );
`;

/** The token goes into the address too, so the person who shared can copy the link again (links are read-only). */
export const SHARES_TOKEN_SQL = `ALTER TABLE shares ADD COLUMN token TEXT;`;

export interface ShareInfo {
  id: string;
  /** The page to open, `#/s/<token>`; null for links made before tokens were kept. */
  page: string | null;
  runId: string;
  /** Traces and collector files (which can hold cookies and tokens) are shared too. */
  traces: boolean;
  createdBy: string | null;
  createdAt: string;
  expiresAt: string | null;
  views: number;
  viewedAt: string | null;
}

export interface DashboardSettings {
  on: boolean;
  /** Packs shown, in order. */
  packs: string[];
  /** Each run on the dashboard opens read-only, like a share link (without traces). */
  linkRuns: boolean;
  /** A title for the page; empty: "Status". */
  title: string;
}

export const DEFAULT_DASHBOARD: DashboardSettings = { on: false, packs: [], linkRuns: false, title: "" };

interface Row {
  id: string;
  token: string | null;
  run_id: string;
  traces: number;
  created_by: string | null;
  created_at: string;
  expires_at: string | null;
  views: number;
  viewed_at: string | null;
}

const toInfo = (r: Row): ShareInfo => ({
  id: r.id,
  page: r.token ? `#/s/${r.token}` : null,
  runId: r.run_id,
  traces: r.traces === 1,
  createdBy: r.created_by,
  createdAt: r.created_at,
  expiresAt: r.expires_at,
  views: r.views,
  viewedAt: r.viewed_at,
});

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
/** 22 characters of base64url: 132 bits, past guessing. */
const newToken = () => randomBytes(17).toString("base64url").slice(0, 22);

export class SharesStore {
  constructor(private readonly db: Database.Database) {}

  list(runId?: string): ShareInfo[] {
    const now = new Date().toISOString();
    const rows = runId
      ? (this.db.prepare("SELECT * FROM shares WHERE run_id = ? AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at DESC").all(runId, now) as Row[])
      : (this.db.prepare("SELECT * FROM shares WHERE expires_at IS NULL OR expires_at > ? ORDER BY created_at DESC").all(now) as Row[]);
    return rows.map(toInfo);
  }

  get(id: string): ShareInfo | null {
    const r = this.db.prepare("SELECT * FROM shares WHERE id = ?").get(id) as Row | undefined;
    return r ? toInfo(r) : null;
  }

  /** A new link: `token` goes in the address. */
  add(runId: string, opts: { days?: number | undefined; traces?: boolean | undefined; by?: string | undefined }): { token: string; info: ShareInfo } {
    const token = newToken();
    const id = randomBytes(6).toString("hex");
    const now = new Date();
    const expires = opts.days ? new Date(now.getTime() + opts.days * 24 * 60 * 60_000).toISOString() : null;
    this.db
      .prepare("INSERT INTO shares (id, hash, token, run_id, traces, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, sha256(token), token, runId, opts.traces ? 1 : 0, opts.by ?? null, now.toISOString(), expires);
    return { token, info: this.get(id)! };
  }

  remove(id: string): boolean {
    return this.db.prepare("DELETE FROM shares WHERE id = ?").run(id).changes > 0;
  }

  /** The link a token opens, counting the view when `view`; null when unknown or expired. */
  open(token: string, view = false): ShareInfo | null {
    if (!/^[A-Za-z0-9_-]{22}$/.test(token)) return null;
    const r = this.db.prepare("SELECT * FROM shares WHERE hash = ?").get(sha256(token)) as Row | undefined;
    if (!r || (r.expires_at && Date.parse(r.expires_at) <= Date.now())) return null;
    if (view) this.db.prepare("UPDATE shares SET views = views + 1, viewed_at = ? WHERE id = ?").run(new Date().toISOString(), r.id);
    return toInfo(r);
  }

  /** Links of runs that no longer exist, and expired ones, go. */
  sweep(runExists: (id: string) => boolean): void {
    this.db.prepare("DELETE FROM shares WHERE expires_at IS NOT NULL AND expires_at <= ?").run(new Date().toISOString());
    for (const r of this.db.prepare("SELECT DISTINCT run_id FROM shares").all() as { run_id: string }[]) if (!runExists(r.run_id)) this.db.prepare("DELETE FROM shares WHERE run_id = ?").run(r.run_id);
  }

  config<T>(key: string): T | null {
    const r = this.db.prepare("SELECT value FROM shares_config WHERE key = ?").get(key) as { value: string } | undefined;
    return r ? (JSON.parse(r.value) as T) : null;
  }

  setConfig(key: string, value: unknown): void {
    this.db.prepare("INSERT INTO shares_config (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(key, JSON.stringify(value));
  }
}
