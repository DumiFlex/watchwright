// Alert rules in words, for Settings > Alerts.

export interface Rule {
  id: string;
  name: string;
  triggers: string[];
  packs: string[];
  schedules: string[];
  channels: string[];
  onlyOnChange: boolean;
  enabled: boolean;
}

const RUN_WORDS: Record<string, string> = {
  failed: "fails",
  broken: "ends broken",
  failed_to_start: "doesn't start",
  recovered: "passes again",
  passed: "passes",
  stopped: "is stopped",
};
const OTHER_WORDS: Record<string, string> = {
  test_broken: "a test breaks",
  schedule_missed: "a schedule misses a time",
  approval: "an agent waits for approval",
};

/** "a, b or c". */
export function join(items: string[], word: string): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} ${word} ${items[items.length - 1]}`;
}

/** "When a run fails or passes again, or a test breaks, for Shop and Nightly". */
export function ruleSays(r: Pick<Rule, "triggers" | "packs" | "schedules">, packName: (id: string) => string, scheduleName: (id: string) => string): string {
  const run = r.triggers.flatMap((t) => (RUN_WORDS[t] ? [RUN_WORDS[t]] : []));
  const other = r.triggers.flatMap((t) => (OTHER_WORDS[t] ? [OTHER_WORDS[t]] : []));
  const parts = [...(run.length ? [`a run ${join(run, "or")}`] : []), ...other];
  const scope = [...r.packs.map(packName), ...r.schedules.map(scheduleName)];
  return `When ${join(parts, "or")}${scope.length ? `, for ${join(scope, "and")}` : ""}`;
}
