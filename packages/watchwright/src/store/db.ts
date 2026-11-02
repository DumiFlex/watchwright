import { accessSync, constants, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { MigrationSet } from "./migrations.js";

export const DB_FILE = "watchwright.db";

export interface Store {
  db: Database.Database;
  dataDir: string;
  /** The id of the newest migration applied for `owner` (a plugin name), 0 when none. */
  schemaVersion(owner: string): number;
  close(): void;
}

/** Opens (or creates) the store in `dataDir` and brings every owner's schema up to date. `":memory:"` for tests. */
export function openStore(dataDir: string, migrations: MigrationSet): Store {
  let file = ":memory:";
  if (dataDir !== ":memory:") {
    checkDataDir(dataDir);
    file = path.join(dataDir, DB_FILE);
  }
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  try {
    migrate(db, migrations);
  } catch (err) {
    db.close();
    throw err;
  }
  return {
    db,
    dataDir,
    schemaVersion: (owner) => currentVersion(db, owner),
    close: () => db.close(),
  };
}

function currentVersion(db: Database.Database, owner: string): number {
  const row = db.prepare("SELECT MAX(id) AS id FROM schema_migrations WHERE owner = ?").get(owner) as { id: number | null };
  return row.id ?? 0;
}

/** Applies each owner's pending migrations in id order, each in its own transaction. */
export function migrate(db: Database.Database, migrations: MigrationSet): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      owner      TEXT NOT NULL,
      id         INTEGER NOT NULL,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL,
      PRIMARY KEY (owner, id)
    );
  `);
  const record = db.prepare("INSERT INTO schema_migrations (owner, id, name, applied_at) VALUES (?, ?, ?, ?)");
  for (const [owner, list] of Object.entries(migrations)) {
    const applied = currentVersion(db, owner);
    const pending = [...list].sort((a, b) => a.id - b.id).filter((m) => m.id > applied);
    for (const m of pending) {
      db.transaction(() => {
        db.exec(m.sql);
        record.run(owner, m.id, m.name, new Date().toISOString());
      })();
    }
  }
}

/**
 * Makes the data folder and checks this process may write in it, so a folder owned by someone else
 * (a Docker bind mount the host made as root) gets a message that says how to fix it rather than
 * SQLite's "unable to open database file".
 */
export function checkDataDir(dataDir: string): void {
  try {
    mkdirSync(dataDir, { recursive: true });
    accessSync(dataDir, constants.R_OK | constants.W_OK);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "EACCES" && code !== "EPERM" && code !== "EROFS") throw err;
    throw new Error(dataDirMessage(dataDir, code), { cause: err });
  }
}

function dataDirMessage(dataDir: string, code: string): string {
  if (code === "EROFS") return `Watchwright can't write to its data folder ${dataDir}: it's on a read-only file system. Mount it read-write.`;
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  const gid = typeof process.getgid === "function" ? process.getgid() : undefined;
  let owner = "";
  try {
    const st = statSync(dataDir);
    owner = ` It belongs to user ${st.uid}${uid === undefined ? "" : `, and Watchwright runs as user ${uid}`}.`;
  } catch {
    // the folder (or one above it) can't even be looked at
  }
  const fix =
    uid === undefined
      ? "Give the user Watchwright runs as permission to write there."
      : `In Docker, run this on the host for the folder mounted at ${dataDir}: sudo chown -R ${uid}:${gid ?? uid} <that folder>`;
  return `Watchwright can't write to its data folder ${dataDir}.${owner} ${fix}`;
}
