import { describe, expect, it } from "vitest";
import { loadKinds, outcomeLabel } from "../src/kinds";

describe("outcome labels", () => {
  it("uses a kind's word for an outcome, else the outcome", async () => {
    const fetcher = (async () =>
      new Response(JSON.stringify({ data: [{ name: "test", labels: {} }, { name: "extract", labels: { passed: "done" } }] }), { headers: { "content-type": "application/json" } })) as typeof fetch;
    expect(outcomeLabel("passed", "extract")).toBe("passed");
    await loadKinds(fetcher);
    expect(outcomeLabel("passed", "extract")).toBe("done");
    expect(outcomeLabel("broken", "extract")).toBe("broken");
    expect(outcomeLabel("passed", "test")).toBe("passed");
    expect(outcomeLabel("passed")).toBe("passed");
    expect(outcomeLabel("passed", "unknown")).toBe("passed");
  });
});
