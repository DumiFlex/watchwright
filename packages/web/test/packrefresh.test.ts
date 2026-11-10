import { describe, expect, it } from "vitest";
import type { Pack } from "../src/api";
import { packChanges } from "../src/packrefresh";

const pack = (tests: string[], params: string[], tasks: string[]) =>
  ({
    tests: tests.map((id) => ({ id })),
    params: Object.fromEntries(params.map((k) => [k, { type: "string" }])),
    tasks: tasks.map((id) => ({ id })),
  }) as unknown as Pack;

describe("packChanges", () => {
  it("says nothing when the pack is the same", () => {
    expect(packChanges(pack(["a"], ["who"], []), pack(["a"], ["who"], []))).toEqual([]);
  });

  it("counts tests, parameters and tasks added and gone", () => {
    expect(packChanges(pack(["a", "b"], ["who"], []), pack(["a", "c", "d"], ["who", "where"], ["restore"]))).toEqual(["2 tests added", "1 test gone", "1 parameter added", "1 task added"]);
  });
});
