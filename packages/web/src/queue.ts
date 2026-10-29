// Rules for the queue on the run page: which rows get move buttons and which way they can go.
// The server checks needs and has the last word; these only hide buttons that can't work.

export interface QueueRow {
  testId: string;
  status: string;
}

/** A test moves as a whole, so its move buttons sit on its first row, and only while none of its attempts has started. */
export function movable(plan: readonly QueueRow[], i: number): boolean {
  const p = plan[i];
  if (!p || plan[i - 1]?.testId === p.testId) return false;
  return plan.filter((x) => x.testId === p.testId).every((x) => x.status === "pending");
}

/** Whether a test that hasn't started sits next to the test on row `i` in that direction. */
export function canMove(plan: readonly QueueRow[], i: number, direction: -1 | 1): boolean {
  const id = plan[i]?.testId;
  if (id === undefined) return false;
  let j = i;
  while (plan[j]?.testId === id) j += direction;
  return plan[j]?.status === "pending";
}

/** A box's scroll window and one row in it, in the box's own coordinates (row top from the list's top). */
export interface ScrollBox {
  scrollTop: number;
  height: number;
}
export interface RowBox {
  top: number;
  height: number;
}

/** Whether the row shows whole in the box. */
export function rowInView(box: ScrollBox, row: RowBox): boolean {
  return row.top >= box.scrollTop && row.top + row.height <= box.scrollTop + box.height;
}

/** Where to scroll the box so the row sits a third of the way down, or null when it already shows. */
export function followTop(box: ScrollBox, row: RowBox): number | null {
  if (rowInView(box, row)) return null;
  return Math.max(0, Math.round(row.top - box.height / 3));
}
