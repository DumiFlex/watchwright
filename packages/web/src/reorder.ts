// Order logic for SortableList, kept apart from the component to test it.

/** A copy of `items` with the item at `from` moved to `to`. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const out = [...items];
  if (from === to || from < 0 || from >= out.length) return out;
  const [it] = out.splice(from, 1);
  out.splice(Math.min(Math.max(0, to), out.length), 0, it as T);
  return out;
}

/**
 * Where a dragged item belongs for a pointer at `y`, given the vertical middle of every
 * item in the list as drawn now (`mids`, the dragged one at `from` included). Items that
 * can't move (`locked`) keep their places, so the result skips past them.
 */
export function dropIndex(mids: readonly number[], y: number, from: number, locked: (i: number) => boolean = () => false): number {
  let to = from;
  for (let i = from + 1; i < mids.length; i++) if (y > mids[i]!) to = i;
  for (let i = from - 1; i >= 0; i--) if (y < mids[i]!) to = i;
  // Never land on or past a locked item's place from the wrong side.
  if (to > from) for (let i = from + 1; i <= to; i++) if (locked(i)) return i - 1;
  if (to < from) for (let i = from - 1; i >= to; i--) if (locked(i)) return i + 1;
  return to;
}
