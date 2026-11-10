// Building a pack again from the page (the refresh icon), and saying what changed. The server also
// does it by itself when the files change (Admin > Packs), see docs/research/pack-refresh.md.
import { sendJson, type Pack } from "./api";
import { toast } from "./toasts";

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

function diff(label: string, before: readonly string[], after: readonly string[]): string[] {
  const was = new Set(before);
  const now = new Set(after);
  const added = after.filter((x) => !was.has(x)).length;
  const gone = before.filter((x) => !now.has(x)).length;
  return [...(added ? [`${plural(added, label)} added`] : []), ...(gone ? [`${plural(gone, label)} gone`] : [])];
}

/** What changed between two builds of a pack, in words: tests, parameters and tasks added or gone. */
export function packChanges(before: Pack, after: Pack): string[] {
  return [
    ...diff("test", before.tests.map((t) => t.id), after.tests.map((t) => t.id)),
    ...diff("parameter", Object.keys(before.params), Object.keys(after.params)),
    ...diff("task", before.tasks.map((t) => t.id), after.tasks.map((t) => t.id)),
  ];
}

/** Builds the pack again and says how it went. Returns the new pack, or null when the call failed. */
export async function refreshPack(before: Pack): Promise<Pack | null> {
  const res = await sendJson<Pack>(`/api/v1/packs/${before.id}/reload`);
  if (!res.ok) {
    toast(res.error.message, { tone: "bad" });
    return null;
  }
  const after = res.data;
  if (after.status === "error") toast(`${after.name} doesn't load: ${after.error ?? "see its page"}`, { tone: "bad" });
  else {
    const changes = packChanges(before, after);
    toast(changes.length ? `${after.name} built again: ${changes.join(", ")}.` : `${after.name} built again. Nothing changed in its tests, parameters or tasks.`, { tone: "ok" });
  }
  return after;
}
