// A small description of what a YAML value may look like. The step list, test files and
// `pack.yaml` are all described with it; the loader checks files against it (with positions and
// "did you mean"), and the JSON Schema shipped for editors and agents is generated from it.
//
// This file and the others in this folder except run.ts and pack-yaml.ts import nothing from
// Node or Playwright, so the web app can use them too.

export type Shape =
  | { t: "string"; doc?: string; enum?: readonly string[]; pattern?: string }
  | { t: "number" | "integer"; doc?: string; min?: number; max?: number }
  | { t: "boolean"; doc?: string }
  /** A string, number or boolean. */
  | { t: "scalar"; doc?: string }
  /** Anything; checked elsewhere (a rubric, Playwright context options). */
  | { t: "any"; doc?: string }
  | { t: "object"; doc?: string; props: Record<string, Prop>; extra?: Shape; check?: (value: Record<string, unknown>) => string | null }
  | { t: "array"; doc?: string; items: Shape; min?: number }
  /** The first member whose YAML type (text, map or list) fits the value. */
  | { t: "union"; doc?: string; of: readonly Shape[] }
  /** A list of steps (see steps.ts). */
  | { t: "steps"; doc?: string }
  /** An element on the page (see targets.ts). */
  | { t: "target"; doc?: string }
  /** Text to match: a string, or `{ regex, flags }`. */
  | { t: "match"; doc?: string };

export type Prop = Shape & { required?: boolean };

export const str = (doc?: string, extra: Partial<{ enum: readonly string[]; pattern: string }> = {}): Shape => ({ t: "string", ...(doc ? { doc } : {}), ...extra });
export const num = (doc?: string, extra: Partial<{ min: number; max: number }> = {}): Shape => ({ t: "number", ...(doc ? { doc } : {}), ...extra });
export const int = (doc?: string, extra: Partial<{ min: number; max: number }> = {}): Shape => ({ t: "integer", ...(doc ? { doc } : {}), ...extra });
export const bool = (doc?: string): Shape => ({ t: "boolean", ...(doc ? { doc } : {}) });
export const req = (s: Shape): Prop => ({ ...s, required: true });
export const list = (items: Shape, doc?: string): Shape => ({ t: "array", items, ...(doc ? { doc } : {}) });
export const oneOrMore = (items: Shape, doc?: string): Shape => ({ t: "union", of: [items, list(items)], ...(doc ? { doc } : {}) });
export const obj = (props: Record<string, Prop>, doc?: string, extra?: Partial<{ extra: Shape; check: (v: Record<string, unknown>) => string | null }>): Shape => ({
  t: "object",
  props,
  ...(doc ? { doc } : {}),
  ...extra,
});

/** Edit distance (with swapped letters as one edit), for "did you mean". */
export function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const same = a[i - 1]!.toLowerCase() === b[j - 1]!.toLowerCase();
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (same ? 0 : 1));
      // Two letters swapped count as one edit.
      if (i > 1 && j > 1 && a[i - 1]!.toLowerCase() === b[j - 2]!.toLowerCase() && a[i - 2]!.toLowerCase() === b[j - 1]!.toLowerCase()) d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
    }
  return d[a.length]![b.length]!;
}

/** The closest of `names` to `word`, when it's close enough to be a likely typo. */
export function closest(word: string, names: Iterable<string>): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  for (const n of names) {
    const dist = distance(word, n);
    if (dist < bestD) {
      best = n;
      bestD = dist;
    }
  }
  return best !== null && bestD <= (word.length <= 3 ? 1 : Math.min(3, Math.ceil(word.length / 3))) ? best : null;
}

/** True for a string that holds a `${…}` variable, which may stand for a number or a yes/no. */
export const hasVariable = (s: string): boolean => /(^|[^$])\$\{[^}]+\}/.test(s);
