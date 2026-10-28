import { describe, expect, it } from "vitest";
import type { Artifact } from "../src/api";
import { attemptOrder, attemptSteps, besideFile, cellOf, isMarkdown, logMarks, plainText, recordColumns, shotGroups, traceViewerUrl } from "../src/attempt";

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

describe("step timeline", () => {
  const doc = {
    startedAt: "2026-10-27T10:00:00.000Z",
    finishedAt: "2026-10-27T10:00:10.000Z",
    steps: [
      { title: "open", depth: 0, startedAt: "2026-10-27T10:00:01.000Z", finishedAt: "2026-10-27T10:00:05.000Z", status: "passed" as const },
      { title: "type", depth: 1, startedAt: "2026-10-27T10:00:02.000Z", finishedAt: "2026-10-27T10:00:03.000Z", status: "passed" as const },
      { title: "send", depth: 0, startedAt: "2026-10-27T10:00:06.000Z", finishedAt: null, status: "running" as const },
    ],
    log: [
      { time: "2026-10-27T10:00:02.500Z", level: "warn" as const, message: "The click timed out but landed." },
      { time: "2026-10-27T10:00:03.000Z", level: "info" as const, message: "Step: type" },
    ],
  };
  it("puts steps on the attempt's time axis with their parents' names", () => {
    expect(attemptSteps(doc)).toEqual([
      { id: "0", label: "open", start: 1000, end: 5000, status: "passed" },
      { id: "1", label: "open › type", start: 2000, end: 3000, status: "passed" },
      { id: "2", label: "send", start: 6000, end: 10000, status: "running" },
    ]);
    expect(attemptSteps({ startedAt: doc.startedAt, finishedAt: null })).toEqual([]);
  });
  it("reads the steps of an older attempt from its log", () => {
    const log = [
      { time: "2026-10-27T10:00:01.000Z", level: "info" as const, message: "Started A1" },
      { time: "2026-10-27T10:00:02.000Z", level: "info" as const, message: "Step: open" },
      { time: "2026-10-27T10:00:02.500Z", level: "warn" as const, message: "Step: not a step" },
      { time: "2026-10-27T10:00:04.000Z", level: "info" as const, message: "Step: send" },
    ];
    expect(attemptSteps({ startedAt: doc.startedAt, finishedAt: doc.finishedAt, steps: [], log })).toEqual([
      { id: "0", label: "open", start: 2000, end: 4000 },
      { id: "1", label: "send", start: 4000, end: 10000 },
    ]);
  });
  it("marks warnings from the log", () => {
    expect(logMarks(doc)).toEqual([{ at: 2500, label: "The click timed out but landed.", tone: "warn" }]);
  });
  it("tells Markdown files and resolves links next to a saved file", () => {
    expect(isMarkdown({ contentType: "text/markdown; charset=utf-8", url: "/f/a" })).toBe(true);
    expect(isMarkdown({ contentType: "application/octet-stream", url: "/f/notes.MD" })).toBe(true);
    expect(isMarkdown({ contentType: "text/plain", url: "/f/a.txt" })).toBe(false);
    const file = "/api/v1/files/runs/r1/A/attempt-1/collectors/ai/debug-01.md";
    expect(besideFile(file, "debug-01.json")).toBe("/api/v1/files/runs/r1/A/attempt-1/collectors/ai/debug-01.json");
    expect(besideFile(file, "../../01-home.png#x")).toBe("/api/v1/files/runs/r1/A/attempt-1/01-home.png#x");
    expect(besideFile(file, "../../../../../r2/x.png")).toBeNull();
    expect(besideFile(file, "https://example.com/")).toBeNull();
    expect(besideFile(file, "/etc/passwd")).toBeNull();
    expect(besideFile(file, "#top")).toBeNull();
    expect(besideFile(file, "")).toBeNull();
  });
});
