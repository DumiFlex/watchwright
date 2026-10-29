// Finding tests on the pack page: a search over each test's words, and filters by section, tag
// and how its last attempts went. Big packs (a bench with over a hundred tests) need them.
import type { HistoryEntry, PackTest } from "./api";
import { flakyReason } from "./history";

/** How a test's recent attempts went, for the status filter. "" is any. */
export type TestState = "" | "failing" | "flaky" | "passing" | "never";

export interface TestFilter {
  search: string;
  section: string;
  tag: string;
  state: TestState;
}

export const NO_FILTER: TestFilter = { search: "", section: "", tag: "", state: "" };

export function stateOf(entries: readonly HistoryEntry[] | undefined): Exclude<TestState, "" | "flaky"> {
  const last = entries?.findLast((e) => e.status !== "skipped" && e.status !== "stopped");
  if (!last) return "never";
  return last.status === "passed" ? "passing" : "failing";
}

/** Every word of the search must appear in the test's id, title, section, tags, file or description. */
export function matchesSearch(t: PackTest, search: string): boolean {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = [t.id, t.title, t.section ?? "", ...t.tags, t.file, t.description ?? ""].join("\n").toLowerCase();
  return words.every((w) => text.includes(w));
}

export function filterTests(tests: readonly PackTest[], f: TestFilter, history: Readonly<Record<string, HistoryEntry[]>>): PackTest[] {
  return tests.filter((t) => {
    if (f.section && (t.section ?? "") !== f.section) return false;
    if (f.tag && !t.tags.includes(f.tag)) return false;
    if (f.state === "flaky" && !flakyReason(history[t.id] ?? [])) return false;
    if (f.state && f.state !== "flaky" && stateOf(history[t.id]) !== f.state) return false;
    return matchesSearch(t, f.search);
  });
}

export const isFiltered = (f: TestFilter) => Boolean(f.search.trim() || f.section || f.tag || f.state);

/** The sections in the order tests first use them; tests without one come under "". */
export function sectionsOf(tests: readonly PackTest[]): string[] {
  return [...new Set(tests.map((t) => t.section ?? ""))];
}

export function tagsOf(tests: readonly PackTest[]): string[] {
  return [...new Set(tests.flatMap((t) => t.tags))].sort((a, b) => a.localeCompare(b));
}
