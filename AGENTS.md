# AGENTS.md

Guidance for AI coding agents (and people) working in this repository. Keep it short and true; update it in the same PR as the change it describes.

## What this is

Watchwright is a browser test harness on the Playwright library. A long-lived server runs test packs in its own run engine (not `npx playwright test`), streams a live screencast to its web page, and exposes every action through an HTTP API (later also a CLI and an MCP server). The base design (plugins, engine, store, API) is [docs/plan.md](docs/plan.md); the plan for the current step is [docs/plans/step-2.md](docs/plans/step-2.md). Read both before adding a feature.

## Commands

```bash
pnpm install
pnpm test         # Vitest (server + web)
pnpm typecheck    # tsc --noEmit + vue-tsc --noEmit
pnpm lint         # ESLint
pnpm build        # server + web app
pnpm serve        # build, then run the server on http://127.0.0.1:7420/
pnpm site:dev     # docs site (VitePress) with hot reload
pnpm site:build   # docs site to packages/site/dist
```

Run `pnpm lint && pnpm typecheck && pnpm test` before every commit.

## Layout

- `packages/watchwright/src/core/` — the plugin contract (`definePlugin`, typed services through `serviceKey`), the built-in plugin list and the `core` plugin (`/health`, `GET /actions`, `GET /events`).
- `packages/watchwright/src/actions/` — the action registry: an action declares name, method, path and JSON Schema input; HTTP routes are generated from it (CLI and MCP later).
- `packages/watchwright/src/events/` — the event log (cursor, bounded wait, subscribe).
- `packages/watchwright/src/session/` — browser sessions (launch, contexts, screencast).
- `packages/watchwright/src/jobs/` — job kinds, run control (pause, stop, broken waits) and the recorder for artifacts.
- `packages/watchwright/src/plugins/` — `live` (frame hub, WebSocket), `packs` (esbuild loader, test ordering), `runs` (engine, results, files), `reviews` (rubric snapshots, reviews, compare, Markdown and zip export), `testing` (the `test` job kind, `h` helpers, outcomes).
- `packages/watchwright/src/server/` — Fastify app: mounts plugins under `/api/v1`, the request guard, the web app with SPA fallback.
- `packages/watchwright/src/store/` — SQLite through better-sqlite3, migrations per plugin.
- `packages/watchwright/src/cli/` — the `watchwright` command.
- `packages/web/` — Vue 3 + Vite web app; `vite build` writes into `packages/watchwright/dist/web`.
- `packages/site/` — the docs site (VitePress): landing page, `guide/`, `reference/`. Built on every PR by `.github/workflows/site.yml`.

## Conventions

- **Capabilities are plugins.** A new capability (runs, packs, later scraping) is a plugin with its own migrations, actions, routes and events. Plugins share code through services (`ctx.services`), not imports of each other's internals. Don't add feature code to `core/` or `server/`; extend the plugin contract instead when a plugin needs something new. See docs/plan.md, section 3.
- **Migrations are append-only and per plugin.** Ids count from 1 within a plugin. Never edit a migration that has been merged; add a new one. A non-core plugin's main table may carry the plugin's name (`runs`); its other tables are named `<plugin>_…` (`runs_attempts`).
- **API shape.** Routes live under `/api/v1`. Success is `{ "data": … }`, failure is `{ "error": { "code", "message", "detail"? } }` with a snake_case `code`.
- **Request guard.** Every request must carry a loopback `Host` with the server's port; state changes and WebSocket upgrades must come from the server's own origin (or carry no `Origin`). Don't weaken this to make a client work; make the client send the right headers (the Vite dev proxy does).
- **TypeScript strict, ESM, Node 22+.** No `any`, no `@ts-ignore`. Imports inside `packages/watchwright` use `.js` extensions (NodeNext).
- **Web app.** Vue 3 `<script setup>` with TypeScript. Colors, fonts, radii and spacing come from the tokens in `src/style.css`, never literals; every look (theme) and mode must work. See [docs/design.md](docs/design.md). No stock browser controls or `title` tooltips: use the control kit in `src/components/` and `v-tip`, and icons from `src/icons.ts` (Lucide), never hand-drawn SVG or text arrows (all shown at `#/kit`, listed in docs/design.md). Pages must work at phone width.
- **Docs site.** A change that users can see or call (a CLI option, an API route, a pack field) updates `packages/site` in the same PR. Pages for things not built yet carry a `::: info Planned` box; remove it when the feature lands. New pages go in the sidebar in `.vitepress/config.ts` (a test checks every link has a page).
- **Screenshots.** Any visible change to the web app ships with screenshots in the PR (light, dark and phone width).
- **Tests.** New code comes with Vitest tests in `packages/*/test/`. Server tests use `app.inject` or a real listener on a free port; never a fixed port that could clash. Engine tests need Playwright browsers (`pnpm --filter watchwright exec playwright install chromium firefox`); the Firefox test skips when Firefox is missing unless `WATCHWRIGHT_REQUIRE_BROWSERS=1`.
- **Commits.** Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, …). PRs to `dev` are squash-merged, so the PR title is the commit; the `pr-title` check enforces the format.
- **No secrets or personal paths** in the repo, tests or screenshots. The repo will be published under Apache-2.0; write docs for strangers.
- **Run the harness gently on real machines.** A bench run can take hours. Never stop or restart a server that has a run in progress unless the person asks.

## Branches and releases

- PRs target `dev` and are squash-merged. `dev` merges into `main` with a **merge commit** (never squash, or every change collapses into one changelog line) when everything on it works.
- Releases are automatic ([release-please](https://github.com/googleapis/release-please), `.github/workflows/release.yml`). A push to `main` opens a release PR with the version bump and `CHANGELOG.md`; it merges itself once CI passes, which tags `vX.Y.Z`, publishes the GitHub release and opens a PR that syncs `main` back into `dev`.
- The commit type picks the bump. Below 1.0: `feat` → minor, `fix`/`perf`/`refactor` → patch, a breaking change (`feat!:`) → minor. `docs`, `chore`, `test`, `ci`, `build` and `style` don't release and stay out of the changelog. Changes only under `.github/` never release.
- Never edit `CHANGELOG.md`, `.release-please-manifest.json` or the `version` fields by hand. To force a version (for example 1.0.0), set `"release-as"` in `release-please-config.json` in a PR, and remove it after the release.
- Don't merge into `dev` while a release PR is open on `main`; let it finish first.
- Each release also publishes the docs site to GitHub Pages, but only once the repository variable `PAGES_ENABLED` is `true`. It stays off while the repository is private, because a Pages site is public. To switch it on: Settings > Pages > Source "GitHub Actions", set the variable, then run the Site workflow on `main` once.
