// Pure helpers for DataTable: sorting and the window of rows to render.

export type SortDir = "asc" | "desc";
export type Sort = { key: string; dir: SortDir } | null;
export type SortValue = string | number | boolean | null | undefined;

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Compares two cell values: empty last, numbers by value, text by locale with numeric parts. */
export function compareValues(a: SortValue, b: SortValue): number {
  const emptyA = a === null || a === undefined || a === "";
  const emptyB = b === null || b === undefined || b === "";
  if (emptyA || emptyB) return emptyA === emptyB ? 0 : emptyA ? 1 : -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return collator.compare(String(a), String(b));
}

/** A stable sort of `rows` by `value`; empty values stay last in both directions. */
export function sortRows<T>(rows: readonly T[], value: (row: T) => SortValue, dir: SortDir): T[] {
  return rows
    .map((row, i) => ({ row, i, v: value(row) }))
    .sort((x, y) => {
      const emptyX = x.v === null || x.v === undefined || x.v === "";
      const emptyY = y.v === null || y.v === undefined || y.v === "";
      if (emptyX !== emptyY) return emptyX ? 1 : -1;
      const c = compareValues(x.v, y.v);
      return (dir === "asc" ? c : -c) || x.i - y.i;
    })
    .map((x) => x.row);
}

/** The next sort when a column heading is clicked: ascending, descending, then none. */
export function nextSort(current: Sort, key: string): Sort {
  if (!current || current.key !== key) return { key, dir: "asc" };
  return current.dir === "asc" ? { key, dir: "desc" } : null;
}

/**
 * Which rows to render for a scroll position, with `overscan` extra rows on each side,
 * and the padding that stands in for the rows left out.
 */
export function rowWindow(scrollTop: number, viewHeight: number, rowHeight: number, count: number, overscan = 8) {
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const last = Math.min(count, Math.ceil((scrollTop + viewHeight) / rowHeight) + overscan);
  const start = Math.min(first, last);
  return { start, end: last, padTop: start * rowHeight, padBottom: (count - last) * rowHeight };
}
