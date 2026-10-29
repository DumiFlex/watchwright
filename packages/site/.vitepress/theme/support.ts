// Where people can support Watchwright's author. One list, so the About page and anything
// else that shows support buttons stay in step.
export interface SupportLink {
  id: "github" | "coffee" | "paypal";
  label: string;
  detail: string;
  href: string;
}

export const supportLinks: SupportLink[] = [
  {
    id: "github",
    label: "Sponsor on GitHub",
    detail: "Monthly or one-time, through GitHub Sponsors.",
    href: "https://github.com/sponsors/DumiFlex",
  },
  {
    id: "coffee",
    label: "Buy me a coffee",
    detail: "A one-off thank you, no account needed.",
    href: "https://buymeacoffee.com/dumiflex",
  },
  {
    id: "paypal",
    label: "PayPal",
    detail: "Send any amount through PayPal.me.",
    href: "https://paypal.me/DumiFlex",
  },
];
