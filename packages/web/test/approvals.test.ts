import { describe, expect, it } from "vitest";
import { titlePrefix } from "../src/approvals";

describe("approvals", () => {
  it("puts the number waiting ahead of the tab's title", () => {
    expect(titlePrefix(0)).toBe("");
    expect(titlePrefix(2)).toBe("(2) Approve? · ");
  });
});
