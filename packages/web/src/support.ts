// Where people can support Watchwright's author, shown under Settings › About. The docs site keeps
// the same list in packages/site/.vitepress/theme/support.ts.
import type { Component } from "vue";
import { Coffee, Heart, Wallet } from "./icons";

export interface SupportLink {
  id: "github" | "coffee" | "paypal";
  label: string;
  detail: string;
  href: string;
  icon: Component;
}

export const SUPPORT_LINKS: SupportLink[] = [
  { id: "github", label: "Sponsor on GitHub", detail: "Monthly or one-time, through GitHub Sponsors.", href: "https://github.com/sponsors/DumiFlex", icon: Heart },
  { id: "coffee", label: "Buy me a coffee", detail: "A one-off thank you, no account needed.", href: "https://buymeacoffee.com/dumiflex", icon: Coffee },
  { id: "paypal", label: "PayPal", detail: "Send any amount through PayPal.me.", href: "https://paypal.me/DumiFlex", icon: Wallet },
];

export const REPO_URL = "https://github.com/DumiFlex/watchwright";
export const DOCS_URL = "https://dumiflex.github.io/watchwright/";
