// "Since the last run" on a run page: the attempts that moved, apart from the ones only one of
// the two runs has. Those are counted, not listed: against a run of a few tests, a full run would
// otherwise list every other test as new, above its own results.

export interface ChangeLike {
  changes: string[];
}

export interface SplitChanges<T> {
  /** Attempts in both runs whose status, flags, score or time moved. */
  moved: T[];
  /** Attempts only this run has. */
  added: number;
  /** Attempts only the earlier run has. */
  gone: number;
}

export function splitChanges<T extends ChangeLike>(rows: readonly T[]): SplitChanges<T> {
  const out: SplitChanges<T> = { moved: [], added: 0, gone: 0 };
  for (const r of rows) {
    if (r.changes.includes("new")) out.added++;
    else if (r.changes.includes("gone")) out.gone++;
    else out.moved.push(r);
  }
  return out;
}

/** How many moved attempts show before "Show all". */
export const CHANGES_SHOWN = 10;
