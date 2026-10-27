import type { KindPlan, PlanItem } from "../../jobs/kind.js";

// The queue of a run that is going: the plan's attempts in the order they will run. A person or an
// agent can skip an attempt that hasn't started or move a test that hasn't started up or down,
// as long as every test still runs after the tests it needs. Edits are kept with the run (its
// options), so a resumed run keeps them.

/** Queue edits as stored with the run. `order` lists test ids; `skip` lists `test#number` keys. */
export interface QueueEdits {
  order?: string[];
  skip?: string[];
}

export class QueueError extends Error {}

const keyOf = (i: PlanItem) => `${i.itemId}#${i.number}`;

export class RunQueue {
  /** Attempts in run order. */
  items: PlanItem[];
  private readonly skips: Set<string>;
  private readonly done = new Set<string>();
  private readonly begun = new Set<string>();

  constructor(
    private readonly plan: Pick<KindPlan, "items" | "needs" | "children">,
    edits: QueueEdits = {},
  ) {
    this.items = plan.items.slice();
    if (edits.order) this.items = this.reordered(edits.order) ?? this.items;
    const known = new Set(plan.items.map(keyOf));
    this.skips = new Set((edits.skip ?? []).filter((k) => known.has(k)));
  }

  /** The next attempt that hasn't finished, or null at the end. */
  next(): PlanItem | null {
    return this.items.find((i) => !this.done.has(keyOf(i))) ?? null;
  }
  started(item: PlanItem): void {
    this.begun.add(keyOf(item));
  }
  finish(item: PlanItem): void {
    this.done.add(keyOf(item));
  }
  isSkipped(item: PlanItem): boolean {
    return this.skips.has(keyOf(item));
  }
  skipped(): string[] {
    return [...this.skips];
  }

  /** Skips (or, with `on` false, keeps) an attempt that hasn't started. */
  skip(testId: string, number: number, on: boolean): void {
    const item = this.items.find((i) => i.itemId === testId && i.number === number);
    if (!item) throw new QueueError(`The run has no attempt ${number} of ${testId}.`);
    if (this.begun.has(keyOf(item)) || this.done.has(keyOf(item))) throw new QueueError(`Attempt ${number} of ${testId} has already started.`);
    if (on) this.skips.add(keyOf(item));
    else this.skips.delete(keyOf(item));
  }

  /** Moves a test that hasn't started one place up or down, past the next test that hasn't started either. */
  move(testId: string, direction: "up" | "down"): void {
    const tests = this.tests();
    const at = tests.indexOf(testId);
    if (at === -1) throw new QueueError(`The run has no test ${testId}.`);
    if (!this.untouched(testId)) throw new QueueError(`${testId} has already started.`);
    const step = direction === "up" ? -1 : 1;
    const to = at + step;
    const other = tests[to];
    if (other === undefined || !this.untouched(other)) throw new QueueError(`${testId} can't move ${direction}: ${other === undefined ? "it's already at the " + (step < 0 ? "top" : "bottom") : `${other} has already started`}.`);
    const next = tests.slice();
    next[at] = other;
    next[to] = testId;
    const problem = this.orderProblem(next);
    if (problem) throw new QueueError(problem);
    this.items = this.reordered(next)!;
  }

  /** Top-level test ids in run order. */
  tests(): string[] {
    return [...new Set(this.items.map((i) => i.itemId))];
  }

  edits(): QueueEdits {
    return { order: this.tests(), skip: this.skipped() };
  }

  private untouched(testId: string): boolean {
    return this.items.filter((i) => i.itemId === testId).every((i) => !this.begun.has(keyOf(i)) && !this.done.has(keyOf(i)));
  }

  /** The items grouped by test in `order` (unknown ids dropped, missing tests kept in plan order at the end), or null when the order breaks a need. */
  private reordered(order: string[]): PlanItem[] | null {
    const byTest = new Map<string, PlanItem[]>();
    for (const i of this.plan.items) byTest.set(i.itemId, [...(byTest.get(i.itemId) ?? []), i]);
    const ids = [...order.filter((id) => byTest.has(id)), ...[...byTest.keys()].filter((id) => !order.includes(id))];
    if (this.orderProblem(ids)) return null;
    return ids.flatMap((id) => byTest.get(id)!);
  }

  /** Why an order of top-level tests doesn't work (a test before something it needs), or null. */
  private orderProblem(ids: string[]): string | null {
    const pos = new Map(ids.map((id, n) => [id, n]));
    // A child runs inside its parent: its needs count as its parent's, and its position is its parent's.
    const where = (id: string) => pos.get(id) ?? pos.get([...this.plan.children].find(([, kids]) => kids.includes(id))?.[0] ?? "");
    for (const id of ids) {
      const own = [id, ...(this.plan.children.get(id) ?? [])];
      for (const t of own)
        for (const n of this.plan.needs.get(t) ?? []) {
          const p = where(n);
          if (p !== undefined && p > pos.get(id)!) return `${t} needs ${n}, so ${id} can't run before it.`;
        }
    }
    return null;
  }
}
