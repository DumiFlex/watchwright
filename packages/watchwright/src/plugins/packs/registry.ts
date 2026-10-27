import { randomBytes } from "node:crypto";
import path from "node:path";
import type Database from "better-sqlite3";
import { serviceKey } from "../../core/services.js";
import type { EventLog } from "../../events/log.js";
import type { FlagKind, ParamDef, TestDefinition } from "./api.js";
import { currentStamp, findPackFile, loadPack, packChanged, PackLoadError, type LoadedPack } from "./loader.js";
import { checkTests, paramType } from "./order.js";
import { rubricFor, type Criterion, type RubricCriterion } from "./rubric.js";

export interface PackTestSummary {
  id: string;
  title: string;
  section: string | null;
  tags: string[];
  needs: string[];
  inside: string | null;
  /** A number, `{ by, …counts }`, or "computed" when the pack gives a function. */
  runs: number | Record<string, unknown> | "computed";
  timeout: number | null;
  file: string;
  /** The criteria reviewers score this test's attempts on. */
  rubric: Criterion[];
}

export interface PackSummary {
  id: string;
  path: string;
  name: string;
  description: string | null;
  siteKey: string | null;
  baseURL: string | null;
  browser: string;
  status: "ok" | "error";
  error: string | null;
  problems: string[];
  loadedAt: string | null;
  addedAt: string;
  params: Record<string, ParamDef & { type: "string" | "number" | "boolean" }>;
  flags: Record<string, FlagKind>;
  /** The pack's run settings with defaults filled in; a run can override each. */
  run: PackRunDefaults;
  /** The pack's review criteria (tests may add or drop some; see each test's `rubric`). */
  rubric: Criterion[];
  tests: PackTestSummary[];
}

export interface PackRunDefaults {
  pauseOnBroken: boolean;
  pauseLimitMinutes: number;
  trace: "problems" | "always" | "never";
  video: boolean;
}

const RUN_DEFAULTS: PackRunDefaults = { pauseOnBroken: true, pauseLimitMinutes: 20, trace: "problems", video: true };

interface Row {
  id: string;
  path: string;
  name: string;
  site_key: string | null;
  status: "ok" | "error";
  error: string | null;
  problems: string;
  summary: string;
  loaded_at: string | null;
  added_at: string;
}

export const PACKS_MIGRATION_SQL = `
  CREATE TABLE packs (
    id        TEXT PRIMARY KEY,
    path      TEXT NOT NULL UNIQUE,
    name      TEXT NOT NULL,
    site_key  TEXT,
    status    TEXT NOT NULL,
    error     TEXT,
    problems  TEXT NOT NULL DEFAULT '[]',
    summary   TEXT NOT NULL DEFAULT '{}',
    loaded_at TEXT,
    added_at  TEXT NOT NULL
  );
`;

function testSummary(t: TestDefinition, rubric: readonly RubricCriterion[] | undefined): PackTestSummary {
  const r = t.meta.runs;
  return {
    id: t.id,
    title: t.meta.title ?? t.id,
    section: t.meta.section ?? null,
    tags: [...(t.meta.tags ?? [])],
    needs: [...(t.meta.needs ?? [])],
    inside: t.meta.inside ?? null,
    runs: r === undefined ? 1 : typeof r === "function" ? "computed" : typeof r === "number" ? r : { ...r },
    timeout: t.meta.timeout ?? null,
    file: t.file,
    rubric: rubricFor(rubric, t.meta.review),
  };
}

/** Knows every pack added to this server, keeps the newest good build of each, and rebuilds on change. */
export class PackRegistry {
  private readonly loaded = new Map<string, LoadedPack>();
  private readonly loading = new Map<string, Promise<LoadedPack>>();

  constructor(
    private readonly db: Database.Database,
    private readonly events: EventLog,
    private readonly cacheRoot: string,
  ) {}

  list(): PackSummary[] {
    return (this.db.prepare("SELECT * FROM packs ORDER BY added_at, id").all() as Row[]).map((r) => this.summary(r));
  }

  get(id: string): PackSummary | null {
    const row = this.db.prepare("SELECT * FROM packs WHERE id = ?").get(id) as Row | undefined;
    return row ? this.summary(row) : null;
  }

  /** Adds a pack by folder or pack file path and loads it. Adding a path twice returns the existing pack. */
  async add(input: string): Promise<PackSummary> {
    const { dir, packFile } = findPackFile(input);
    const full = path.join(dir, packFile);
    const existing = this.db.prepare("SELECT id FROM packs WHERE path = ?").get(full) as { id: string } | undefined;
    if (existing) return this.get(existing.id)!;
    const id = randomBytes(4).toString("hex");
    this.db
      .prepare("INSERT INTO packs (id, path, name, status, added_at) VALUES (?, ?, ?, 'error', ?)")
      .run(id, full, path.basename(dir), new Date().toISOString());
    this.events.append("pack.added", { packId: id, path: full });
    await this.reload(id).catch(() => undefined); // a pack that doesn't load is still added, with its error shown
    return this.get(id)!;
  }

  remove(id: string): boolean {
    this.loaded.delete(id);
    const info = this.db.prepare("DELETE FROM packs WHERE id = ?").run(id);
    if (info.changes > 0) this.events.append("pack.removed", { packId: id });
    return info.changes > 0;
  }

  /** Builds the pack now. On failure the previous good build stays in use, and the error is recorded. */
  async reload(id: string): Promise<LoadedPack> {
    const row = this.db.prepare("SELECT * FROM packs WHERE id = ?").get(id) as Row | undefined;
    if (!row) throw new PackLoadError(`No pack with id ${id}.`);
    const pending = this.loading.get(id);
    if (pending) return pending;
    const job = (async () => {
      try {
        const pack = await loadPack(row.path, path.join(this.cacheRoot, id));
        const problems = checkTests(pack.tests, pack.options.rubric);
        this.store(id, pack, problems);
        this.loaded.set(id, pack);
        this.events.append("pack.loaded", { packId: id, tests: pack.tests.length, problems });
        return pack;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const problems = err instanceof PackLoadError ? err.problems : [];
        this.db.prepare("UPDATE packs SET status = 'error', error = ?, problems = ? WHERE id = ?").run(message.split("\n")[0], JSON.stringify(problems), id);
        this.events.append("pack.reload_failed", { packId: id, message: message.split("\n")[0], problems });
        throw err;
      } finally {
        this.loading.delete(id);
      }
    })();
    this.loading.set(id, job);
    return job;
  }

  /** The current good build, loading it first if needed. Throws when the pack has never loaded. */
  async current(id: string): Promise<LoadedPack> {
    return this.loaded.get(id) ?? this.reload(id);
  }

  /**
   * Before each attempt: rebuild when a source file changed. A build that fails keeps the old code
   * (and logs why), so a typo saved mid-run doesn't stop the run.
   */
  async refresh(id: string): Promise<{ pack: LoadedPack; reloaded: boolean; error?: string }> {
    const old = await this.current(id);
    if (!packChanged(old)) return { pack: old, reloaded: false };
    try {
      return { pack: await this.reload(id), reloaded: true };
    } catch (err) {
      // Remember the broken stamp so the same broken save isn't rebuilt before every attempt.
      const latest = this.loaded.get(id) ?? old;
      this.loaded.set(id, { ...latest, stamp: currentStamp(latest) });
      return { pack: latest, reloaded: false, error: err instanceof Error ? err.message.split("\n")[0]! : String(err) };
    }
  }

  /** True when the pack's files changed since its current build (no rebuild). */
  changed(id: string): boolean {
    const p = this.loaded.get(id);
    return p ? packChanged(p) : false;
  }

  private store(id: string, pack: LoadedPack, problems: string[]): void {
    const o = pack.options;
    const summary = {
      description: o.description ?? null,
      baseURL: o.site.baseURL ?? null,
      browser: o.browser?.name ?? "chromium",
      params: Object.fromEntries(Object.entries(o.params ?? {}).map(([k, d]) => [k, { ...d, type: paramType(d) }])),
      flags: { ...(o.flags ?? {}) },
      run: {
        pauseOnBroken: o.run?.pauseOnBroken ?? RUN_DEFAULTS.pauseOnBroken,
        pauseLimitMinutes: o.run?.pauseLimitMinutes ?? RUN_DEFAULTS.pauseLimitMinutes,
        trace: o.run?.trace ?? RUN_DEFAULTS.trace,
        video: o.run?.video ?? RUN_DEFAULTS.video,
      },
      rubric: rubricFor(o.rubric, undefined),
      tests: pack.tests.map((t) => testSummary(t, o.rubric)),
    };
    this.db
      .prepare("UPDATE packs SET name = ?, site_key = ?, status = ?, error = ?, problems = ?, summary = ?, loaded_at = ? WHERE id = ?")
      .run(o.name, o.site.key, problems.length > 0 ? "error" : "ok", problems.length > 0 ? "The pack's tests don't fit together." : null, JSON.stringify(problems), JSON.stringify(summary), pack.builtAt, id);
  }

  private summary(r: Row): PackSummary {
    const s = JSON.parse(r.summary) as Partial<PackSummary>;
    return {
      id: r.id,
      path: r.path,
      name: r.name,
      description: s.description ?? null,
      siteKey: r.site_key,
      baseURL: s.baseURL ?? null,
      browser: s.browser ?? "chromium",
      status: r.status,
      error: r.error,
      problems: JSON.parse(r.problems) as string[],
      loadedAt: r.loaded_at,
      addedAt: r.added_at,
      params: s.params ?? {},
      flags: s.flags ?? {},
      run: { ...RUN_DEFAULTS, ...s.run },
      rubric: s.rubric ?? rubricFor(undefined, undefined),
      tests: (s.tests ?? []).map((t) => ({ ...t, rubric: t.rubric ?? rubricFor(undefined, undefined) })),
    };
  }
}

export const PACKS = serviceKey<PackRegistry>("packs.registry");
