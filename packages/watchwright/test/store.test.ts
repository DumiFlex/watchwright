import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openStore } from "../src/store/db.js";
import { BUILTIN_PLUGINS } from "../src/core/builtin.js";
import { corePlugin } from "../src/core/core-plugin.js";
import { migrationsOf } from "../src/core/plugin.js";
import type { Migration } from "../src/store/migrations.js";

const CORE = corePlugin.migrations ?? [];
const BUILTIN = migrationsOf(BUILTIN_PLUGINS);

const dirs: string[] = [];
const tempDir = () => {
  const d = mkdtempSync(path.join(tmpdir(), "ww-store-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("store", () => {
  it("applies every migration to a new database", () => {
    const store = openStore(":memory:", BUILTIN);
    expect(store.schemaVersion("core")).toBe(Math.max(...CORE.map((m) => m.id)));
    const tables = store.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
    expect(tables.map((t) => t.name)).toEqual(expect.arrayContaining(["schema_migrations", "meta"]));
    store.close();
  });

  it("creates the data folder and reopens without reapplying", () => {
    const dir = path.join(tempDir(), "nested", "data");
    openStore(dir, BUILTIN).close();
    const again = openStore(dir, BUILTIN);
    const rows = again.db.prepare("SELECT id FROM schema_migrations").all();
    expect(rows).toHaveLength(Object.values(BUILTIN).flat().length);
    again.close();
  });

  it("applies only the new migrations to an older database", () => {
    const dir = tempDir();
    openStore(dir, { core: CORE }).close();
    const next = [...CORE, { id: 999, name: "test_extra", sql: "CREATE TABLE extra (id INTEGER PRIMARY KEY);" }];
    const store = openStore(dir, { core: next });
    expect(store.schemaVersion("core")).toBe(999);
    expect(store.db.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get()).toEqual({ n: next.length });
    store.close();
  });

  it("rolls back a migration that fails", () => {
    const dir = tempDir();
    const bad: Migration[] = [...CORE, { id: CORE.length + 1, name: "broken", sql: "CREATE TABLE half (id INTEGER); THIS IS NOT SQL;" }];
    expect(() => openStore(dir, { core: bad })).toThrow();
    const store = openStore(dir, BUILTIN);
    expect(store.schemaVersion("core")).toBe(CORE.length);
    expect(store.db.prepare("SELECT name FROM sqlite_master WHERE name = 'half'").get()).toBeUndefined();
    store.close();
  });

  it("keeps each plugin's migrations apart", () => {
    const store = openStore(":memory:", {
      ...BUILTIN,
      scrape: [
        { id: 1, name: "init", sql: "CREATE TABLE scrape_items (id INTEGER PRIMARY KEY);" },
        { id: 2, name: "more", sql: "ALTER TABLE scrape_items ADD COLUMN url TEXT;" },
      ],
    });
    expect(store.schemaVersion("core")).toBe(CORE.length);
    expect(store.schemaVersion("scrape")).toBe(2);
    expect(store.schemaVersion("absent")).toBe(0);
    store.close();
  });
});
