import type Database from "better-sqlite3";

// Who called the MCP server lately, for Settings > Agents: one row per caller name.

/** Tools that start something the person can watch. */
const STARTS = new Set(["start_run", "explore_start"]);

export interface SeenAgent {
  name: string;
  firstAt: string;
  lastAt: string;
  lastTool: string;
  calls: number;
  /** Runs and explore sessions it started. */
  started: number;
}

interface Row {
  name: string;
  first_at: string;
  last_at: string;
  last_tool: string;
  calls: number;
  started: number;
}

export class Seen {
  static readonly SQL = `CREATE TABLE agents_seen (
  name TEXT PRIMARY KEY,
  first_at TEXT NOT NULL,
  last_at TEXT NOT NULL,
  last_tool TEXT NOT NULL,
  calls INTEGER NOT NULL DEFAULT 0,
  started INTEGER NOT NULL DEFAULT 0
);`;

  constructor(private readonly db: Database.Database) {}

  note(name: string, tool: string, at = new Date()): void {
    const when = at.toISOString();
    const started = STARTS.has(tool) ? 1 : 0;
    this.db
      .prepare(
        `INSERT INTO agents_seen (name, first_at, last_at, last_tool, calls, started) VALUES (?, ?, ?, ?, 1, ?)
         ON CONFLICT(name) DO UPDATE SET last_at = excluded.last_at, last_tool = excluded.last_tool, calls = calls + 1, started = started + excluded.started`,
      )
      .run(name, when, when, tool, started);
  }

  /** Callers seen in the last `days`, most recent first. */
  list(days: number, now = new Date()): SeenAgent[] {
    const since = new Date(now.getTime() - days * 86_400_000).toISOString();
    const rows = this.db.prepare("SELECT * FROM agents_seen WHERE last_at >= ? ORDER BY last_at DESC").all(since) as Row[];
    return rows.map((r) => ({ name: r.name, firstAt: r.first_at, lastAt: r.last_at, lastTool: r.last_tool, calls: r.calls, started: r.started }));
  }
}
