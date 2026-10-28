import { describe, expect, it } from "vitest";
import type { HistoryEntry } from "../src/api";
import { entryText, flakyReason, medianMs, passRate } from "../src/history";

let n = 0;
const e = (status: HistoryEntry["status"], extra: Partial<HistoryEntry> = {}): HistoryEntry => ({
  attemptId: String(++n).padStart(12, "0"),
  runId: "0a1b2c3d",
  runLabel: "",
  number: 1,
  try: 1,
  status,
  startedAt: "2026-10-27T10:00:00.000Z",
  durationMs: 1000,
  params: {},
  ...extra,
});

describe("passRate", () => {
  it("counts passed against passed, failed and broken", () => {
    expect(passRate([e("passed"), e("failed"), e("broken"), e("passed"), e("skipped"), e("stopped")])).toBe(0.5);
  });
  it("is null with nothing that counts", () => {
    expect(passRate([e("skipped")])).toBeNull();
    expect(passRate([])).toBeNull();
  });
});

describe("medianMs", () => {
  it("takes the middle time of passed and failed attempts", () => {
    expect(medianMs([e("passed", { durationMs: 3000 }), e("failed", { durationMs: 1000 }), e("passed", { durationMs: 2000 }), e("broken", { durationMs: 99000 })])).toBe(2000);
    expect(medianMs([e("passed", { durationMs: 1000 }), e("passed", { durationMs: 2001 })])).toBe(1501);
    expect(medianMs([e("passed", { durationMs: null })])).toBeNull();
  });
});

describe("flakyReason", () => {
  it("is flaky when the result flips back and forth with the same values", () => {
    expect(flakyReason([e("passed"), e("failed"), e("passed")])).toMatch(/between passing and failing/);
  });
  it("is not flaky for a regression, a fix, or one that always fails", () => {
    expect(flakyReason([e("passed"), e("passed"), e("failed"), e("failed")])).toBeNull();
    expect(flakyReason([e("failed"), e("passed"), e("passed")])).toBeNull();
    expect(flakyReason([e("failed"), e("failed")])).toBeNull();
  });
  it("keeps parameter values apart, whatever their order", () => {
    const de = { lang: "de", n: 1 };
    const en = { lang: "en", n: 1 };
    expect(flakyReason([e("passed", { params: de }), e("failed", { params: en }), e("passed", { params: de }), e("failed", { params: en })])).toBeNull();
    expect(flakyReason([e("passed", { params: de }), e("failed", { params: { n: 1, lang: "de" } }), e("passed", { params: de })])).not.toBeNull();
  });
  it("ignores broken and skipped attempts between results", () => {
    expect(flakyReason([e("passed"), e("broken"), e("passed")])).toBeNull();
  });
  it("is flaky when a pass needed another try", () => {
    expect(flakyReason([e("passed", { try: 2 })])).toMatch(/run again/);
  });
});

describe("entryText", () => {
  it("names the status, run, time and values", () => {
    const text = entryText(e("passed", { try: 2, runLabel: "nightly", params: { lang: "de" } }), (ms) => `${ms} ms`, () => "today");
    expect(text).toBe("passed on try 2 · run nightly (0a1b2c3d) · today · 1000 ms · lang=de");
    expect(entryText(e("failed", { durationMs: null }), () => "", () => "today")).toBe("failed · run 0a1b2c3d · today");
  });
});
