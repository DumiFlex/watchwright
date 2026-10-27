import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import type { Criterion } from "../src/plugins/packs/rubric.js";
import { compare, onFive, type CompareInput } from "../src/plugins/reviews/compare.js";
import { toMarkdown } from "../src/plugins/reviews/markdown.js";
import type { Review } from "../src/plugins/reviews/repo.js";
import { crc32, zip } from "../src/plugins/reviews/zip.js";
import type { RunDetail } from "../src/plugins/runs/engine.js";
import type { ResultDocument } from "../src/plugins/runs/results.js";

// Compare, the Markdown writer and the zip writer, on made-up runs.

const criteria: Criterion[] = [
  { id: "overall", title: "Overall", description: null, kind: "scale", scale: 5 },
  { id: "tone", title: "Tone", description: null, kind: "choices", choices: ["dry", "warm"] },
];

const counts = { passed: 0, failed: 0, broken: 0, skipped: 0, stopped: 0, running: 0, interrupted: 0, planned: 0 };
function runOf(id: string, params: Record<string, string>, plan: [string, number][]): RunDetail {
  return {
    id, packId: "pack0001", packName: "Shop | checks", siteKey: "shop", kind: "test", tests: [], params, info: {}, options: {}, label: "", status: "finished", mode: "normal",
    startedBy: "web", error: null, createdAt: "2026-10-27T10:00:00.000Z", startedAt: "2026-10-27T10:00:01.000Z", finishedAt: null, counts: { ...counts, passed: plan.length },
    plan: plan.map(([testId, number]) => ({ testId, title: `Test ${testId}`, number, of: 2, status: "passed", attemptId: null })),
    attempts: [], live: null,
  };
}
function docOf(runId: string, attemptId: string, testId: string, number: number, extra: Partial<ResultDocument> = {}): ResultDocument {
  return {
    schemaVersion: 1, runId, attemptId, kind: "test", test: { id: testId, title: `Test ${testId}` },
    attempt: { number, of: 2, try: 1, current: true, parentId: null }, status: "passed", error: null, flags: [], metrics: {}, notes: [], texts: {}, log: [], steps: [],
    startedAt: "2026-10-27T10:00:01.000Z", finishedAt: "2026-10-27T10:00:02.500Z", durationMs: 1500, folder: `runs/${runId}/${attemptId}`, artifacts: [], ...extra,
  };
}
function reviewOf(runId: string, attemptId: string, testId: string, reviewer: string, scores: Review["scores"], note = ""): Review {
  return { runId, packId: "pack0001", attemptId, testId, reviewer, scores, note, createdAt: "", updatedAt: "" };
}

describe("compare", () => {
  const a: CompareInput = {
    run: runOf("aaaa0001", { model: "q9" }, [["S1", 1], ["S1", 2], ["T2", 1]]),
    results: [
      docOf("aaaa0001", "a00000000001", "S1", 1, {
        flags: [{ name: "slow", kind: "finding", detail: "took | 9 s", declared: true }],
        metrics: { load: { value: 412, unit: "ms" } },
        texts: { answer: "Hello" },
        artifacts: [
          { kind: "shot", name: "home", contentType: "image/png", path: "runs/aaaa0001/a00000000001/home.png", size: 1, url: "/api/v1/files/runs/aaaa0001/a00000000001/home.png" },
          { kind: "trace", name: "trace", contentType: "application/zip", path: "runs/aaaa0001/a00000000001/trace.zip", size: 1, url: "/x" },
        ],
      }),
      docOf("aaaa0001", "a00000000002", "S1", 2, { status: "failed", error: { kind: "assertion", message: "expected 3\nreceived 2" } as ResultDocument["error"] }),
      docOf("aaaa0001", "a00000000003", "T2", 1),
      docOf("aaaa0001", "a0000000000f", "S1", 2, { attempt: { number: 2, of: 2, try: 1, current: false, parentId: null } }),
    ],
    reviews: [
      reviewOf("aaaa0001", "a00000000001", "S1", "web", { overall: 4, tone: "warm" }, "Reads well."),
      reviewOf("aaaa0001", "a00000000001", "S1", "agent-7", { overall: 5 }),
      reviewOf("aaaa0001", "a00000000002", "S1", "web", { overall: 2 }),
    ],
    criteria: () => criteria,
  };
  const b: CompareInput = {
    run: runOf("bbbb0002", { model: "haiku" }, [["S1", 1], ["U3", 1]]),
    results: [docOf("bbbb0002", "b00000000001", "S1", 1), docOf("bbbb0002", "b00000000002", "U3", 1)],
    reviews: [reviewOf("bbbb0002", "b00000000001", "S1", "web", { overall: 3 })],
    criteria: () => criteria,
  };

  it("lines up current attempts by test and number", () => {
    const c = compare([a, b]);
    expect(c.runs.map((r) => r.id)).toEqual(["aaaa0001", "bbbb0002"]);
    expect(c.rows.map((r) => `${r.testId}#${r.number}:${r.cells.map((x) => x?.attemptId ?? "-").join(",")}`)).toEqual([
      "S1#1:a00000000001,b00000000001",
      "S1#2:a00000000002,-",
      "T2#1:a00000000003,-",
      "U3#1:-,b00000000002",
    ]);
    const cell = c.rows[0]!.cells[0]!;
    expect(cell.score).toBe(4.5);
    expect(cell.shots.map((s) => s.name)).toEqual(["home"]);
    expect(c.shotNames).toEqual(["home"]);
    expect(c.textNames).toEqual(["answer"]);
    expect(c.rows[0]!.cells[1]!.score).toBe(3);
    expect(c.rows[2]!.cells[0]!.score).toBeNull();
    expect(onFive(10, 10)).toBe(5);
    expect(onFive(1, 3)).toBe(1);
  });

  it("writes Markdown for one run and for several", () => {
    const one = toMarkdown(compare([a]), { link: (s) => `http://h${s.url}`, now: "2026-10-27T12:30:00.000Z" });
    expect(one).toContain("# Shop \\| checks: run aaaa0001");
    expect(one).toContain("Exported 2026-10-27 12:30 UTC");
    expect(one).toContain("| aaaa0001 | 2026-10-27 10:00 | model=q9 | finished |");
    expect(one).toContain("## S1 Test S1");
    expect(one).toContain("Mean score: 3.3");
    expect(one).toContain("- `slow` (finding): took \\| 9 s");
    expect(one).toContain("Metrics: load 412 ms");
    expect(one).toContain("| Criterion | web | agent-7 |");
    expect(one).toContain("| Overall | 4 / 5 | 5 / 5 |");
    expect(one).toContain("| Tone | warm | – |");
    expect(one).toContain("> **web**: Reads well.");
    expect(one).toContain("Screenshots: [home](http://h/api/v1/files/runs/aaaa0001/a00000000001/home.png)");
    expect(one).toContain("Error: expected 3");
    expect(one).not.toContain("received 2");
    expect(one).toContain("Not reviewed.");
    expect(one).not.toMatch(/\n{3}/);

    const two = toMarkdown(compare([a, b]), { link: (s) => s.path, now: "2026-10-27T12:30:00.000Z" });
    expect(two).toContain("# Shop \\| checks: 2 runs compared");
    expect(two).toContain("Mean score: aaaa0001 3.3, bbbb0002 3.0");
    expect(two).toContain("#### Run bbbb0002 (model=haiku)");
    expect(two).toMatch(/### Attempt 2\n\n#### Run aaaa0001 \(model=q9\)\n\n\*\*failed\*\*[^]*#### Run bbbb0002 \(model=haiku\)\n\nNot run\./);

    const bare = (id: string): CompareInput => ({ ...a, run: { ...a.run, id, params: {} } });
    const three = toMarkdown(compare([bare("cccc0003"), bare("dddd0004")]), { link: (s) => s.path, now: "2026-10-27T12:30:00.000Z" });
    expect(three).toContain("#### Run cccc0003\n");
    expect(three).not.toContain("#### Run cccc0003 (");

    const named = toMarkdown(compare([{ ...a, run: { ...a.run, label: "nightly | de" } }]), { link: (s) => s.path, now: "2026-10-27T12:30:00.000Z" });
    expect(named).toContain("# Shop \\| checks: run aaaa0001 (nightly \\| de)");
    expect(named).toContain("| aaaa0001 nightly \\| de | 2026-10-27 10:00 |");
  });
});

describe("zip", () => {
  it("computes CRC-32", () => {
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
  });

  it("writes entries a reader can find and inflate", () => {
    const text = Buffer.from("# Hello\n".repeat(50));
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const z = zip([{ name: "report.md", data: text }, { name: "shots/ab/c d.png", data: png }]);
    const end = z.length - 22;
    expect(z.readUInt32LE(end)).toBe(0x06054b50);
    expect(z.readUInt16LE(end + 10)).toBe(2);
    let at = z.readUInt32LE(end + 16);
    const found: Record<string, Buffer> = {};
    for (let i = 0; i < 2; i++) {
      expect(z.readUInt32LE(at)).toBe(0x02014b50);
      const method = z.readUInt16LE(at + 10);
      const size = z.readUInt32LE(at + 20);
      const nameLen = z.readUInt16LE(at + 28);
      const local = z.readUInt32LE(at + 42);
      const name = z.subarray(at + 46, at + 46 + nameLen).toString("utf8");
      const start = local + 30 + z.readUInt16LE(local + 26);
      const body = z.subarray(start, start + size);
      found[name] = method === 8 ? inflateRawSync(body) : Buffer.from(body);
      expect(crc32(found[name])).toBe(z.readUInt32LE(at + 16));
      at += 46 + nameLen;
    }
    expect(found["report.md"]!.equals(text)).toBe(true);
    expect(found["shots/ab/c d.png"]!.equals(png)).toBe(true);
  });
});
