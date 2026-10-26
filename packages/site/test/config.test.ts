import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { DefaultTheme } from "vitepress";
import config from "../.vitepress/config.js";

const root = fileURLToPath(new URL("..", import.meta.url));

function links(items: DefaultTheme.SidebarItem[] | DefaultTheme.NavItem[]): string[] {
  return items.flatMap((item) => [
    ...("link" in item && item.link ? [item.link] : []),
    ...("items" in item && item.items ? links(item.items as DefaultTheme.SidebarItem[]) : []),
  ]);
}

describe("site config", () => {
  it("serves from /watchwright/ by default, the GitHub Pages project path", () => {
    expect(config.base).toBe("/watchwright/");
  });

  it("points every nav and sidebar link at a page that exists", () => {
    const theme = config.themeConfig ?? {};
    const sidebar = Array.isArray(theme.sidebar) ? theme.sidebar : [];
    const all = [...links(theme.nav ?? []), ...links(sidebar)];
    expect(all.length).toBeGreaterThan(0);
    for (const link of all) {
      expect(existsSync(`${root}${link.slice(1)}.md`), link).toBe(true);
    }
  });
});
