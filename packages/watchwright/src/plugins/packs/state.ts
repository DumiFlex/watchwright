import type Database from "better-sqlite3";
import { serviceKey } from "../../core/services.js";
import type { PackState } from "./api.js";

// Pack state: named JSON values a pack keeps between runs, tasks and restarts (the name of the
// backup its setup took, which run's data a task saved). See docs/research/run-lifecycle-tasks.md.

/** Largest value kept, as JSON text. */
export const STATE_VALUE_LIMIT = 64 * 1024;
/** Most keys one pack keeps. */
export const STATE_KEY_LIMIT = 200;
const KEY = /^[A-Za-z0-9_.:-]{1,100}$/;

export const PACK_STATE_SQL = `
  CREATE TABLE packs_state (
    pack_id    TEXT NOT NULL,
    key        TEXT NOT NULL,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (pack_id, key)
  );
`;

export interface PackStateEntry {
  key: string;
  value: unknown;
  updatedAt: string;
}

/** Every pack's state, in the packs plugin's database. */
export class PackStateStore {
  constructor(private readonly db: Database.Database) {}

  /** The store a pack's code sees. Errors are plain `Error`s with a message for the pack's author. */
  of(packId: string): PackState {
    return {
      get: <T>(key: string): T | undefined => {
        const row = this.db.prepare("SELECT value FROM packs_state WHERE pack_id = ? AND key = ?").get(packId, key) as { value: string } | undefined;
        return row ? (JSON.parse(row.value) as T) : undefined;
      },
      set: (key, value) => this.set(packId, key, value),
      delete: (key) => void this.delete(packId, key),
      keys: () => (this.db.prepare("SELECT key FROM packs_state WHERE pack_id = ? ORDER BY key").all(packId) as { key: string }[]).map((r) => r.key),
    };
  }

  list(packId: string): PackStateEntry[] {
    const rows = this.db.prepare("SELECT key, value, updated_at FROM packs_state WHERE pack_id = ? ORDER BY key").all(packId) as { key: string; value: string; updated_at: string }[];
    return rows.map((r) => ({ key: r.key, value: JSON.parse(r.value) as unknown, updatedAt: r.updated_at }));
  }

  set(packId: string, key: string, value: unknown): void {
    if (typeof key !== "string" || !KEY.test(key)) throw new Error(`State key "${String(key)}" must be 1 to 100 letters, digits, dots, colons, dashes or underscores.`);
    if (value === undefined) {
      this.delete(packId, key);
      return;
    }
    let text: string | undefined;
    try {
      text = JSON.stringify(value);
    } catch (err) {
      throw new Error(`State "${key}" can't be saved as JSON: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
    }
    if (text === undefined) throw new Error(`State "${key}" can't be saved as JSON (a function or symbol?).`);
    if (text.length > STATE_VALUE_LIMIT) throw new Error(`State "${key}" is ${text.length} characters as JSON; the limit is ${STATE_VALUE_LIMIT}. Keep big data in a file and save its name.`);
    const exists = this.db.prepare("SELECT 1 FROM packs_state WHERE pack_id = ? AND key = ?").get(packId, key);
    if (!exists) {
      const n = (this.db.prepare("SELECT COUNT(*) AS n FROM packs_state WHERE pack_id = ?").get(packId) as { n: number }).n;
      if (n >= STATE_KEY_LIMIT) throw new Error(`The pack already keeps ${STATE_KEY_LIMIT} state values; delete some first.`);
    }
    this.db
      .prepare("INSERT INTO packs_state (pack_id, key, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (pack_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
      .run(packId, key, text, new Date().toISOString());
  }

  /** True when the key was there. */
  delete(packId: string, key: string): boolean {
    return this.db.prepare("DELETE FROM packs_state WHERE pack_id = ? AND key = ?").run(packId, key).changes > 0;
  }

  /** Drops a removed pack's state. */
  forget(packId: string): void {
    this.db.prepare("DELETE FROM packs_state WHERE pack_id = ?").run(packId);
  }
}

/** Named values packs keep between runs and tasks (`state` in setup, teardown, tasks and hooks). */
export const PACK_STATE = serviceKey<PackStateStore>("packs.state");
