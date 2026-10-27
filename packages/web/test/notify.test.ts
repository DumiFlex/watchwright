import { describe, expect, it } from "vitest";
import { noticeTarget } from "../src/notify";

describe("run notices", () => {
  it("go to the desktop while the tab is hidden", () => {
    expect(noticeTarget(true, "3011fc76", "3011fc76")).toBe("desktop");
    expect(noticeTarget(true, null, "3011fc76")).toBe("desktop");
  });

  it("show as a toast elsewhere in the app, and not at all on the run's own page", () => {
    expect(noticeTarget(false, null, "3011fc76")).toBe("toast");
    expect(noticeTarget(false, "aaaaaaaa", "3011fc76")).toBe("toast");
    expect(noticeTarget(false, "3011fc76", "3011fc76")).toBeNull();
  });
});
