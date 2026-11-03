import type Database from "better-sqlite3";
import type { PackGuard } from "../../actions/registry.js";
import type { CallUser } from "../../core/access.js";
import { serviceKey } from "../../core/services.js";

// Pack access (docs/plans/pack-access.md): with login on, an admin can keep a pack to chosen people
// and groups. A pack without a rule is open to everyone signed in, as before. Admins see every
// pack. Everything that belongs to a pack follows it (runs, files, reviews, events…), and a
// hidden pack answers `not_found`, so its name doesn't leak.

export const PACK_ACCESS_SQL = `
  CREATE TABLE packs_access (
    pack_id    TEXT PRIMARY KEY,
    people     TEXT NOT NULL,
    groups     TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

/** Who may see a pack besides the admins: user ids and group names. */
export interface PackAccessRule {
  people: string[];
  groups: string[];
  updatedBy: string;
  updatedAt: string;
}

/** A pack's access: `everyone`, or only `chosen` people and groups. */
export type PackAccess = { mode: "everyone" } | ({ mode: "chosen" } & PackAccessRule);

/** Finds the pack a thing of some kind belongs to: a run's, a proposal's, a schedule's… */
export type PackResolver = (id: string) => string | null;

export class PackAccessStore implements PackGuard {
  private readonly rules = new Map<string, PackAccessRule>();
  private readonly resolvers = new Map<string, PackResolver>();

  constructor(private readonly db: Database.Database) {
    const rows = db.prepare("SELECT pack_id, people, groups, updated_by, updated_at FROM packs_access").all() as { pack_id: string; people: string; groups: string; updated_by: string; updated_at: string }[];
    for (const r of rows) this.rules.set(r.pack_id, { people: JSON.parse(r.people) as string[], groups: JSON.parse(r.groups) as string[], updatedBy: r.updated_by, updatedAt: r.updated_at });
    this.resolve("pack", (id) => id);
  }

  /** Teaches the guard how to find the pack of a thing of this kind (plugins call it in `setup`). */
  resolve(kind: string, fn: PackResolver): void {
    if (this.resolvers.has(kind)) throw new Error(`Two plugins find the pack of a "${kind}".`);
    this.resolvers.set(kind, fn);
  }

  packOf(kind: string, id: string): string | null {
    const fn = this.resolvers.get(kind);
    if (!fn) throw new Error(`Nothing finds the pack of a "${kind}"; register it with PACK_ACCESS.resolve.`);
    return fn(id);
  }

  get(packId: string): PackAccess {
    const r = this.rules.get(packId);
    return r ? { mode: "chosen", ...r, people: [...r.people], groups: [...r.groups] } : { mode: "everyone" };
  }

  /** Every pack kept to chosen people, by pack id. */
  all(): Record<string, PackAccess> {
    return Object.fromEntries([...this.rules.keys()].map((id) => [id, this.get(id)]));
  }

  /** Keeps a pack to these people and groups (admins always see it), or opens it to everyone with null. */
  set(packId: string, rule: { people: string[]; groups: string[] } | null, by: string): PackAccess {
    if (!rule) {
      this.db.prepare("DELETE FROM packs_access WHERE pack_id = ?").run(packId);
      this.rules.delete(packId);
      return { mode: "everyone" };
    }
    const people = [...new Set(rule.people)].sort();
    const groups = [...new Set(rule.groups.map((g) => g.trim()).filter(Boolean))].sort();
    const at = new Date().toISOString();
    this.db
      .prepare("INSERT INTO packs_access (pack_id, people, groups, updated_by, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (pack_id) DO UPDATE SET people = excluded.people, groups = excluded.groups, updated_by = excluded.updated_by, updated_at = excluded.updated_at")
      .run(packId, JSON.stringify(people), JSON.stringify(groups), by, at);
    this.rules.set(packId, { people, groups, updatedBy: by, updatedAt: at });
    return this.get(packId);
  }

  /** Drops a removed pack's rule. */
  forget(packId: string): void {
    this.set(packId, null, "");
  }

  sees(user: CallUser | null | undefined, packId: string): boolean {
    if (user === undefined) return true;
    if (user === null) return false;
    if (user.role === "admin") return true;
    const r = this.rules.get(packId);
    if (!r) return true;
    if (r.people.includes(user.id)) return true;
    const mine = new Set((user.groups ?? []).map((g) => g.toLowerCase()));
    return r.groups.some((g) => mine.has(g.toLowerCase()));
  }

  /** Packs with a rule this caller isn't in: what lists across packs leave out. */
  hiddenFrom(user: CallUser | null | undefined): string[] {
    return [...this.rules.keys()].filter((id) => !this.sees(user, id));
  }

  /** Whether an event belongs to a pack this caller can't see (by its `packId`, or its run's pack). */
  hidesEvent(user: CallUser | null | undefined, e: { runId?: string | undefined; data: Record<string, unknown> }): boolean {
    if (user === undefined || this.rules.size === 0) return false;
    const runId = e.runId ?? (typeof e.data.runId === "string" ? e.data.runId : undefined);
    // A recording's events carry the recording's id as their run.
    const ofRun = (id: string) => (this.resolvers.has("run") ? this.packOf("run", id) : null) ?? (this.resolvers.has("recording") ? this.packOf("recording", id) : null);
    const packId = typeof e.data.packId === "string" ? e.data.packId : runId ? ofRun(runId) : null;
    return packId !== null && !this.sees(user, packId);
  }
}

/** Pack access for other plugins: who sees which pack, and `resolve` to teach it a kind of thing. */
export const PACK_ACCESS = serviceKey<PackAccessStore>("packs.access");
