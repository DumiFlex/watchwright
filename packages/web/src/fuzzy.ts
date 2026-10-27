// Fuzzy matching for the command palette: the letters of the query appear in order in the
// text, not necessarily side by side. Matches at word starts and in a row score higher.

export interface FuzzyMatch {
  score: number;
  /** Indexes of the matched characters in the text, for highlighting. */
  hits: number[];
}

const wordStart = (text: string, i: number) => i === 0 || /[\s\-_/.:]/.test(text[i - 1] ?? "") || (/[a-z]/.test(text[i - 1] ?? "") && /[A-Z]/.test(text[i] ?? ""));

/** How well `query` matches `text`, or null when it doesn't. An empty query matches everything. */
export function fuzzy(query: string, text: string): FuzzyMatch | null {
  const q = query.trim().toLowerCase().replace(/\s+/g, " ");
  if (!q) return { score: 0, hits: [] };
  const t = text.toLowerCase();
  // A plain substring is the best kind of match; earlier is better.
  const at = t.indexOf(q);
  if (at >= 0) {
    const hits = Array.from({ length: q.length }, (_, k) => at + k);
    return { score: 100 + (wordStart(text, at) ? 50 : 0) - at, hits };
  }
  const hits: number[] = [];
  let score = 0;
  let from = 0;
  for (const ch of q) {
    if (ch === " ") continue;
    // Prefer the next word start that has the letter, then any later position.
    let i = -1;
    for (let j = from; j < t.length; j++) {
      if (t[j] === ch && wordStart(text, j)) {
        i = j;
        break;
      }
    }
    const prev = hits.at(-1) ?? -2;
    const plain = t.indexOf(ch, from);
    // Staying in a row beats jumping to a word start.
    if (i < 0 || (plain >= 0 && plain === prev + 1)) i = plain;
    if (i < 0) return null;
    score += wordStart(text, i) ? 10 : 1;
    if (i === prev + 1) score += 5;
    hits.push(i);
    from = i + 1;
  }
  return { score: score - (hits[0] ?? 0) * 0.1, hits };
}

/** Splits `text` into runs of matched and unmatched characters, for drawing highlights. */
export function markHits(text: string, hits: readonly number[]): { text: string; hit: boolean }[] {
  const set = new Set(hits);
  const out: { text: string; hit: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const hit = set.has(i);
    const last = out.at(-1);
    if (last && last.hit === hit) last.text += text[i];
    else out.push({ text: text[i] ?? "", hit });
  }
  return out;
}
