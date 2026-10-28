import { describe, expect, it } from "vitest";
import { join, ruleSays } from "../src/alerts";

describe("alert rules in words", () => {
  it("joins lists", () => {
    expect(join([], "or")).toBe("");
    expect(join(["a"], "or")).toBe("a");
    expect(join(["a", "b", "c"], "and")).toBe("a, b and c");
  });

  it("says when a rule sends and for what", () => {
    const names = (id: string) => ({ p1: "Shop", s1: "Nightly" })[id] ?? id;
    expect(ruleSays({ triggers: ["failed", "recovered"], packs: [], schedules: [] }, names, names)).toBe("When a run fails or passes again");
    expect(ruleSays({ triggers: ["broken", "test_broken", "approval"], packs: ["p1"], schedules: ["s1"] }, names, names)).toBe(
      "When a run ends broken, a test breaks or an agent waits for approval, for Shop and Nightly",
    );
  });
});
