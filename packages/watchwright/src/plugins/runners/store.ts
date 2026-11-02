import { createHash, randomBytes, randomInt } from "node:crypto";
import type Database from "better-sqlite3";

// Runners (docs/plans/self-hosting.md, section 6): a machine that lets runs reach sites only it can
// reach. Added on the page with a name and an allow list, paired once with a short code that
// trades for a runner token. Codes and tokens are kept as hashes.

export const RUNNERS_SQL = `
  CREATE TABLE runners (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
    allow       TEXT NOT NULL,
    token_hash  TEXT UNIQUE,
    created_by  TEXT,
    created_at  TEXT NOT NULL,
    paired_at   TEXT,
    last_seen   TEXT,
    version     TEXT,
    platform    TEXT
  );
  CREATE TABLE runners_pairs (
    code_hash   TEXT PRIMARY KEY,
    runner_id   TEXT NOT NULL REFERENCES runners (id) ON DELETE CASCADE,
    expires_at  TEXT NOT NULL
  );
`;

/** A pair code works for this long. */
export const PAIR_MINUTES = 15;

export interface RunnerInfo {
  id: string;
  name: string;
  /** What the runner may open on its machine: the list it reported when it last connected, else the one it was added with. */
  allow: string[];
  createdBy: string | null;
  createdAt: string;
  pairedAt: string | null;
  lastSeen: string | null;
  version: string | null;
  platform: string | null;
}

interface Row {
  id: string;
  name: string;
  allow: string;
  token_hash: string | null;
  created_by: string | null;
  created_at: string;
  paired_at: string | null;
  last_seen: string | null;
  version: string | null;
  platform: string | null;
}

const toInfo = (r: Row): RunnerInfo => ({
  id: r.id,
  name: r.name,
  allow: JSON.parse(r.allow) as string[],
  createdBy: r.created_by,
  createdAt: r.created_at,
  pairedAt: r.paired_at,
  lastSeen: r.last_seen,
  version: r.version,
  platform: r.platform,
});

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
/** No 0/O, 1/I/L or U: easy to read out and type. */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

/** A pair code as people type it (any case, with or without dashes and spaces), as stored. */
export const normalizeCode = (code: string) => code.toUpperCase().replace(/[\s-]/g, "");

function newCode(): string {
  const c = Array.from({ length: 9 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return `${c.slice(0, 3)}-${c.slice(3, 6)}-${c.slice(6)}`;
}

export class RunnersStore {
  constructor(private readonly db: Database.Database) {}

  list(): RunnerInfo[] {
    return (this.db.prepare("SELECT * FROM runners ORDER BY name COLLATE NOCASE").all() as Row[]).map(toInfo);
  }

  get(idOrName: string): RunnerInfo | null {
    const r = this.db.prepare("SELECT * FROM runners WHERE id = ? OR name = ? COLLATE NOCASE").get(idOrName, idOrName) as Row | undefined;
    return r ? toInfo(r) : null;
  }

  add(name: string, allow: string[], by: string | null): RunnerInfo {
    const id = randomBytes(4).toString("hex");
    this.db.prepare("INSERT INTO runners (id, name, allow, created_by, created_at) VALUES (?, ?, ?, ?, ?)").run(id, name, JSON.stringify(allow), by, new Date().toISOString());
    return this.get(id)!;
  }

  remove(id: string): boolean {
    this.db.prepare("DELETE FROM runners_pairs WHERE runner_id = ?").run(id);
    return this.db.prepare("DELETE FROM runners WHERE id = ?").run(id).changes > 0;
  }

  /** A new pair code for a runner (the old ones stop working). */
  pairCode(id: string): { code: string; expiresAt: string } {
    const code = newCode();
    const expiresAt = new Date(Date.now() + PAIR_MINUTES * 60_000).toISOString();
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM runners_pairs WHERE runner_id = ? OR expires_at <= ?").run(id, new Date().toISOString());
      this.db.prepare("INSERT INTO runners_pairs (code_hash, runner_id, expires_at) VALUES (?, ?, ?)").run(sha256(normalizeCode(code)), id, expiresAt);
    })();
    return { code, expiresAt };
  }

  /** Trades a pair code for a new runner token (the runner's old token stops working); null when the code is unknown or expired. */
  pair(code: string): { token: string; runner: RunnerInfo } | null {
    const hash = sha256(normalizeCode(code));
    return this.db.transaction(() => {
      const p = this.db.prepare("SELECT runner_id, expires_at FROM runners_pairs WHERE code_hash = ?").get(hash) as { runner_id: string; expires_at: string } | undefined;
      if (!p) return null;
      this.db.prepare("DELETE FROM runners_pairs WHERE code_hash = ?").run(hash);
      if (Date.parse(p.expires_at) <= Date.now()) return null;
      const token = `wwr_${randomBytes(24).toString("base64url")}`;
      this.db.prepare("UPDATE runners SET token_hash = ?, paired_at = ? WHERE id = ?").run(sha256(token), new Date().toISOString(), p.runner_id);
      const runner = this.get(p.runner_id);
      return runner ? { token, runner } : null;
    })();
  }

  byToken(token: string): RunnerInfo | null {
    if (!token.startsWith("wwr_")) return null;
    const r = this.db.prepare("SELECT * FROM runners WHERE token_hash = ?").get(sha256(token)) as Row | undefined;
    return r ? toInfo(r) : null;
  }

  /** What a runner said about itself when it connected. */
  seen(id: string, info: { allow?: string[]; version?: string; platform?: string }): void {
    const r = this.db.prepare("SELECT * FROM runners WHERE id = ?").get(id) as Row | undefined;
    if (!r) return;
    this.db
      .prepare("UPDATE runners SET last_seen = ?, allow = ?, version = ?, platform = ? WHERE id = ?")
      .run(new Date().toISOString(), info.allow ? JSON.stringify(info.allow) : r.allow, info.version ?? r.version, info.platform ?? r.platform, id);
  }
}
