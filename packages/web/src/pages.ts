// The web app's menu, built from the pages the server's plugins bring (`GET /health`), so a
// page shows only when its plugin is loaded. Views stay compiled into the app; this decides
// which ones the menu and the command palette offer.

import type { Component } from "vue";
import type { HealthPage } from "./api";
import * as icons from "./icons";
import type { Route } from "./router";

/** The built-in pages, used until the server answers (or when it can't be reached). */
export const DEFAULT_PAGES: HealthPage[] = [
  { plugin: "runs", name: "runs", title: "Runs", path: "/", icon: "ListChecks", menu: "main", order: 10, words: "history list" },
  { plugin: "packs", name: "packs", title: "Packs", path: "/packs", icon: "FolderOpen", menu: "main", order: 20, words: "tests suites" },
  { plugin: "reviews", name: "compare", title: "Compare", path: "/compare", icon: "Columns2", menu: "main", order: 30, words: "side by side matrix export" },
  { plugin: "runs", name: "new-run", title: "New run", path: "/new", icon: "Plus", menu: "more", order: 40, words: "start" },
  { plugin: "settings", name: "settings", title: "Settings", path: "/settings", icon: "Settings", menu: "more", order: 90, words: "preferences editor folders" },
];

/** The page a route belongs to, by page name; null for pages every server has (the kit). */
export function pageOf(route: Route): string | null {
  switch (route.name) {
    case "runs":
    case "run":
    case "attempt":
      return "runs";
    case "new":
      return "new-run";
    case "packs":
    case "pack":
    case "edit":
      return "packs";
    case "compare":
      return "compare";
    case "settings":
      return "settings";
    case "kit":
      return null;
  }
}

/** Whether the server has the page a route shows (pages of plugins it didn't load don't open). */
export function hasPage(pages: readonly HealthPage[], route: Route): boolean {
  const name = pageOf(route);
  return name === null || pages.some((p) => p.name === name);
}

export interface NavItem {
  value: string;
  label: string;
  href: string;
  current: boolean;
  /** In the top bar as well as the menu. */
  main: boolean;
}

/** Menu entries in order, with the one the route is on marked current. */
export function navFrom(pages: readonly HealthPage[], route: Route): NavItem[] {
  const on = pageOf(route);
  return pages.map((p) => ({ value: p.name, label: p.title, href: `#${p.path}`, current: on === p.name, main: p.menu === "main" }));
}

const ICONS = icons as unknown as Record<string, Component | undefined>;

/** A page's icon by its Lucide name; a plain dot when the app doesn't have that icon. */
export function pageIcon(name: string): Component {
  return ICONS[name] ?? icons.CircleDot;
}
