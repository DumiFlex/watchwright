import { defineConfig } from "vitepress";

// The site is served from https://<owner>.github.io/watchwright/ once Pages is switched on
// (see .github/workflows/site.yml). WATCHWRIGHT_SITE_BASE overrides that for other hosts.
const base = process.env.WATCHWRIGHT_SITE_BASE ?? "/watchwright/";

export default defineConfig({
  title: "Watchwright",
  description: "A browser test harness on Playwright that you watch work live, control from its own website, and drive from your own AI agents.",
  base,
  outDir: "dist",
  cacheDir: "dist/.cache",
  cleanUrls: true,
  lastUpdated: false,
  head: [["link", { rel: "icon", type: "image/svg+xml", href: `${base}logo.svg` }]],
  themeConfig: {
    // Light and dark marks follow the site's own theme switch; the favicon follows the OS.
    logo: { light: "/logo-light.svg", dark: "/logo-dark.svg" },
    nav: [
      { text: "Guide", link: "/guide/getting-started", activeMatch: "/guide/" },
      { text: "Reference", link: "/reference/http-api", activeMatch: "/reference/" },
    ],
    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Getting started", link: "/guide/getting-started" },
          { text: "How it works", link: "/guide/how-it-works" },
          { text: "Writing a test pack", link: "/guide/test-packs" },
          { text: "Safety", link: "/guide/safety" },
        ],
      },
      {
        text: "Reference",
        items: [{ text: "HTTP and WebSocket API", link: "/reference/http-api" }],
      },
    ],
    search: { provider: "local" },
    outline: { level: [2, 3] },
    footer: { message: "Released under the Apache-2.0 license." },
  },
});
