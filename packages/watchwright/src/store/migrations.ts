/** One step of a plugin's store schema. Ids count from 1 within each plugin. A shipped migration is never edited. */
export interface Migration {
  id: number;
  name: string;
  sql: string;
}

/** The migrations of each plugin, keyed by plugin name. */
export type MigrationSet = Record<string, readonly Migration[]>;
