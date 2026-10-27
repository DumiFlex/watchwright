// Unsaved edits in the editor, kept while the person moves between files and pages so nothing
// typed is lost; the editor marks those files. Closing the tab with unsaved edits asks first.

export interface Draft {
  packId: string;
  path: string;
  text: string;
  /** The text as it is on disk (as last read or saved). */
  saved: string;
  stamp: string;
}

const drafts = new Map<string, Draft>();
const keyOf = (packId: string, path: string) => `${packId}\n${path}`;

export function getDraft(packId: string, path: string): Draft | null {
  return drafts.get(keyOf(packId, path)) ?? null;
}

export function putDraft(d: Draft): void {
  if (d.text === d.saved) drafts.delete(keyOf(d.packId, d.path));
  else drafts.set(keyOf(d.packId, d.path), { ...d });
}

export function dropDraft(packId: string, path: string): void {
  drafts.delete(keyOf(packId, path));
}

/** Paths of a pack's files with unsaved edits. */
export function dirtyPaths(packId: string): string[] {
  return [...drafts.values()].filter((d) => d.packId === packId).map((d) => d.path);
}

export const anyDirty = (): boolean => drafts.size > 0;

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (e) => {
    if (anyDirty()) e.preventDefault();
  });
}
