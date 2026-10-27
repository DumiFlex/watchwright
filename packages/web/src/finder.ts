// What Ctrl+K finds besides pages and looks: packs, runs and tests, and the commands that act on
// them (a new run of a pack, run the latest run again, add a pack). Pure, so the words are tested.
import type { PaletteCommand } from "./components/CommandPalette.vue";
import { runName, type Pack, type RunSummary } from "./api";
import { ago } from "./format";
import { FileCode, FolderPlus, FolderSearch, History, Package, Plus, Repeat } from "./icons";

export interface FinderActions {
  go(hash: string): void;
  /** Starts a run again with the same choices. */
  again(runId: string): void;
}

const ACTIVE = new Set(["queued", "running", "pausing", "paused"]);
const STATUS: Record<string, string> = { failed_to_start: "didn't start" };

/** A run as one line: its label or id after the pack's name. */
export function runLine(r: Pick<RunSummary, "id" | "label" | "packName">): string {
  return r.label ? `${r.packName}: ${runName(r)}` : `${r.packName} ${r.id}`;
}

export function finderCommands(packs: readonly Pack[], runs: readonly RunSummary[], act: FinderActions, now = Date.now()): PaletteCommand[] {
  const out: PaletteCommand[] = [];
  const latest = runs.find((r) => !ACTIVE.has(r.status));
  if (latest) {
    out.push({ id: "again-latest", label: "Run again: the latest run", note: runLine(latest), group: "Commands", words: "repeat rerun restart", icon: Repeat, run: () => act.again(latest.id) });
  }
  out.push(
    { id: "add-pack", label: "Add a pack", group: "Commands", words: "browse folder open import", icon: FolderPlus, run: () => act.go("#/packs?browse=add") },
    { id: "find-packs", label: "Find packs in a folder", group: "Commands", words: "search scan", icon: FolderSearch, run: () => act.go("#/packs?browse=find") },
  );
  for (const p of packs) {
    out.push(
      { id: `pack-${p.id}`, label: p.name, note: p.status === "ok" ? `${p.tests.length} tests` : "doesn't load", group: "Packs", words: `pack ${p.id} ${p.siteKey ?? ""} ${p.dir}`, icon: Package, searchOnly: true, run: () => act.go(`#/packs/${p.id}`) },
      { id: `new-${p.id}`, label: `New run: ${p.name}`, group: "Commands", words: "start", icon: Plus, searchOnly: true, run: () => act.go(`#/new?pack=${p.id}`) },
    );
    for (const t of p.tests) {
      out.push({
        id: `test-${p.id}-${t.id}`,
        label: t.title && t.title !== t.id ? `${t.id} ${t.title}` : t.id,
        note: p.name,
        group: "Tests",
        words: `test ${t.section ?? ""} ${t.tags.join(" ")} ${t.file}`,
        icon: FileCode,
        searchOnly: true,
        run: () => act.go(`#/new?pack=${p.id}&test=${encodeURIComponent(t.id)}`),
      });
    }
  }
  for (const r of runs) {
    const values = Object.entries(r.params)
      .map(([k, v]) => `${k}=${String(v)}`)
      .join(" ");
    out.push({
      id: `run-${r.id}`,
      label: runLine(r),
      note: `${STATUS[r.status] ?? r.status} · ${ago(r.createdAt, now)}`,
      group: "Runs",
      words: `run ${r.id} ${r.label} ${r.status} ${values}`,
      icon: History,
      searchOnly: true,
      run: () => act.go(`#/runs/${r.id}`),
    });
  }
  return out;
}
