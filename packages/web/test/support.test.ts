import { describe, expect, it } from "vitest";
import { supportLinks as siteLinks } from "../../site/.vitepress/theme/support";
import { SUPPORT_LINKS } from "../src/support";

describe("support links", () => {
  it("are https links, one per way to give", () => {
    expect(SUPPORT_LINKS.map((l) => l.id)).toEqual(["github", "coffee", "paypal"]);
    for (const l of SUPPORT_LINKS) expect(new URL(l.href).protocol).toBe("https:");
  });

  it("match the docs site's About page", () => {
    expect(SUPPORT_LINKS.map(({ id, label, href }) => ({ id, label, href }))).toEqual(siteLinks.map(({ id, label, href }) => ({ id, label, href })));
  });
});
