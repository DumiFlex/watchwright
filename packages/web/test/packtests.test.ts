import { describe, expect, it } from "vitest";
import type { HistoryEntry, PackTest } from "../src/api";
import { NO_FILTER, filterTests, groupTests, isFiltered, matchesSearch, sectionsOf, stateOf, tagsOf } from "../src/packtests";

const t = (id: string, extra: Partial<PackTest> = {}): PackTest => ({
  id,
  title: `Test ${id}`,
  section: null,
  tags: [],
  needs: [],
  inside: [],
  description: null,
  runs: 1,
  file: `tests/${id.toLowerCase()}.ts`,
  line: null,
  rubric: [],
  ...extra,
});
let n = 0;
const e = (status: HistoryEntry["status"], params: HistoryEntry["params"] = {}): HistoryEntry => ({
  attemptId: String(++n).padStart(12, "0"),
  runId: "0a1b2c3d",
  runLabel: "",
  number: 1,
  try: 1,
  status,
  startedAt: "2026-10-29T10:00:00.000Z",
  durationMs: 1000,
  params,
});

const tests = [
  t("S1", { title: "Test connection", section: "Connection", tags: ["s"], description: "Press Test connection once the model is loaded" }),
  t("W1", { title: "New wildcard from nothing", section: "Wildcards", tags: ["w", "ai"] }),
  t("W2", { title: "Edit a wildcard", section: "Wildcards" }),
  t("X1", { title: "Loose test" }),
];

describe("matchesSearch", () => {
  it("needs every word, in any field and any case", () => {
    expect(matchesSearch(tests[0]!, "connection model")).toBe(true);
    expect(matchesSearch(tests[0]!, "CONNECTION wildcard")).toBe(false);
    expect(matchesSearch(tests[1]!, "w1")).toBe(true);
    expect(matchesSearch(tests[2]!, "tests/w2")).toBe(true);
    expect(matchesSearch(tests[1]!, "  ")).toBe(true);
  });
});

describe("filterTests", () => {
  const history = { S1: [e("failed"), e("passed")], W1: [e("passed"), e("broken"), e("skipped")], W2: [e("passed"), e("failed"), e("passed")] };

  it("keeps everything with no filter", () => {
    expect(filterTests(tests, NO_FILTER, history)).toHaveLength(4);
    expect(isFiltered(NO_FILTER)).toBe(false);
  });

  it("filters by section, tag and search together", () => {
    const ids = (f: Partial<typeof NO_FILTER>) => filterTests(tests, { ...NO_FILTER, ...f }, history).map((x) => x.id);
    expect(ids({ section: "Wildcards" })).toEqual(["W1", "W2"]);
    expect(ids({ section: "Wildcards", search: "edit" })).toEqual(["W2"]);
    expect(ids({ tag: "ai" })).toEqual(["W1"]);
    expect(ids({ section: "" , search: "loose" })).toEqual(["X1"]);
  });

  it("filters by how the last attempts went", () => {
    const ids = (state: (typeof NO_FILTER)["state"]) => filterTests(tests, { ...NO_FILTER, state }, history).map((x) => x.id);
    expect(ids("failing")).toEqual(["W1"]);
    expect(ids("passing")).toEqual(["S1", "W2"]);
    expect(ids("never")).toEqual(["X1"]);
    expect(ids("flaky")).toEqual(["W2"]);
  });
});

describe("stateOf", () => {
  it("looks at the newest attempt that ran", () => {
    expect(stateOf(undefined)).toBe("never");
    expect(stateOf([e("skipped")])).toBe("never");
    expect(stateOf([e("passed"), e("stopped")])).toBe("passing");
    expect(stateOf([e("passed"), e("broken")])).toBe("failing");
  });
});

it("lists sections in order of use and tags sorted", () => {
  expect(sectionsOf(tests)).toEqual(["Connection", "Wildcards", ""]);
  expect(tagsOf(tests)).toEqual(["ai", "s", "w"]);
});

it("groups tests under their sections in order of use", () => {
  const groups = groupTests(tests);
  expect(groups.map((g) => g.section)).toEqual(sectionsOf(tests));
  expect(groups.flatMap((g) => g.tests).length).toBe(tests.length);
  for (const g of groups) expect(g.tests.every((t) => (t.section ?? "") === g.section)).toBe(true);
  expect(groupTests([])).toEqual([]);
});
