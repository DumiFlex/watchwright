import { describe, expect, it } from "vitest";
import type { Artifact } from "../src/api";
import { attemptOrder, cellOf, plainText, recordColumns, shotGroups, traceViewerUrl } from "../src/attempt";

const art = (name: string, kind = "shot", set?: string): Artifact => ({ kind, name, contentType: "image/png", url: `/f/${name}`, size: 1, ...(set ? { set } : {}) });

describe("attempt page helpers", () => {
  it("steps through planned attempts with their children after them", () => {
    const plan = [
      { attemptId: "a1", testId: "A" },
      { attemptId: null, testId: "B" },
      { attemptId: "c1", testId: "C" },
    ];
    const attempts = [
      { id: "a1", parentId: null },
      { id: "k1", parentId: "c1" },
      { id: "c1", parentId: null },
    ];
    expect(attemptOrder({ plan, attempts } as never)).toEqual(["a1", "c1", "k1"]);
  });
  it("groups scroll sets and keeps single shots and marks between them", () => {
    const groups = shotGroups([art("home"), art("mark", "mark"), art("page 1", "shot", "page"), art("page 2", "shot", "page"), art("trace", "trace"), art("end")]);
    expect(groups.map((g) => [g.set, g.shots.map((s) => s.name)])).toEqual([
      [null, ["home", "mark"]],
      ["page", ["page 1", "page 2"]],
      [null, ["end"]],
    ]);
  });
  it("finds collector columns and cell text", () => {
    expect(recordColumns([{ a: 1, b: 2 }, { b: 3, c: 4 }, "x", null])).toEqual(["a", "b", "c"]);
    expect(recordColumns([{ a: 1, b: 2, c: 3 }], 2)).toEqual(["a", "b"]);
    expect(cellOf(3)).toBe(3);
    expect(cellOf(undefined)).toBeNull();
    expect(cellOf({ x: [1] })).toBe('{"x":[1]}');
  });
  it("links a trace to the served viewer", () => {
    expect(traceViewerUrl("http://127.0.0.1:7420", "/api/v1/files/runs/a/trace.zip")).toBe(
      "/api/v1/trace-viewer/index.html?trace=http%3A%2F%2F127.0.0.1%3A7420%2Fapi%2Fv1%2Ffiles%2Fruns%2Fa%2Ftrace.zip",
    );
  });
  it("drops terminal colour codes from error text", () => {
    expect(plainText("Call log:\n\u001b[2m  - waiting for h1\u001b[22m\n")).toBe("Call log:\n  - waiting for h1\n");
  });
});
