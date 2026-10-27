// Line diff for DiffView: which lines were kept, removed or added between two texts,
// grouped into hunks with a few kept lines of context, and the changed part inside a
// replaced line. A longest-common-subsequence table; fine for files of a few thousand lines.

export type DiffLine = { kind: "same" | "del" | "add"; text: string; a: number | null; b: number | null };
export type Hunk = { lines: DiffLine[] } | { skipped: number; from: number };

/** Every line of `a` and `b` in order, marked kept, removed (only in a) or added (only in b). Numbers count from 1. */
export function diffLines(a: string, b: string): DiffLine[] {
  const x = a === "" ? [] : a.split("\n");
  const y = b === "" ? [] : b.split("\n");
  // Trim the common start and end first; most diffs only touch the middle.
  let start = 0;
  while (start < x.length && start < y.length && x[start] === y[start]) start++;
  let endX = x.length;
  let endY = y.length;
  while (endX > start && endY > start && x[endX - 1] === y[endY - 1]) {
    endX--;
    endY--;
  }
  const n = endX - start;
  const m = endY - start;
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) lcs[i]![j] = x[start + i] === y[start + j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);

  const out: DiffLine[] = [];
  for (let k = 0; k < start; k++) out.push({ kind: "same", text: x[k]!, a: k + 1, b: k + 1 });
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && x[start + i] === y[start + j]) {
      out.push({ kind: "same", text: x[start + i]!, a: start + i + 1, b: start + j + 1 });
      i++;
      j++;
    } else if (j < m && (i >= n || lcs[i]![j + 1]! >= lcs[i + 1]![j]!)) {
      out.push({ kind: "add", text: y[start + j]!, a: null, b: start + j + 1 });
      j++;
    } else {
      out.push({ kind: "del", text: x[start + i]!, a: start + i + 1, b: null });
      i++;
    }
  }
  // Removed lines read better before the added ones that replace them.
  for (let k = 1; k < out.length; k++) {
    let p = k;
    while (p > 0 && out[p]!.kind === "del" && out[p - 1]!.kind === "add") {
      [out[p - 1], out[p]] = [out[p]!, out[p - 1]!];
      p--;
    }
  }
  for (let k = endX; k < x.length; k++) out.push({ kind: "same", text: x[k]!, a: k + 1, b: endY + (k - endX) + 1 });
  return out;
}

/** Groups lines into hunks, keeping `context` unchanged lines around each change and folding runs of two or more of the rest. */
export function hunks(lines: readonly DiffLine[], context = 3): Hunk[] {
  const keep = lines.map(() => false);
  lines.forEach((l, i) => {
    if (l.kind === "same") return;
    for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) keep[k] = true;
  });
  const out: Hunk[] = [];
  let i = 0;
  while (i < lines.length) {
    if (keep[i]) {
      const prev = out[out.length - 1];
      const run: DiffLine[] = prev && "lines" in prev ? prev.lines : [];
      if (run.length === 0) out.push({ lines: run });
      while (i < lines.length && keep[i]) run.push(lines[i++]!);
    } else {
      const from = i;
      while (i < lines.length && !keep[i]) i++;
      // Folding a single line saves nothing: show it.
      if (i - from > 1) out.push({ skipped: i - from, from });
      else {
        const prev = out[out.length - 1];
        if (prev && "lines" in prev) prev.lines.push(lines[from]!);
        else out.push({ lines: [lines[from]!] });
      }
    }
  }
  return out;
}

/** The changed middle of a replaced line: [before, changed, after] for each side. */
export function changedPart(a: string, b: string): { a: [string, string, string]; b: [string, string, string] } {
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let e = 0;
  while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
  return {
    a: [a.slice(0, s), a.slice(s, a.length - e), a.slice(a.length - e)],
    b: [b.slice(0, s), b.slice(s, b.length - e), b.slice(b.length - e)],
  };
}
