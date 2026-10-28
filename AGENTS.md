# AGENTS.md

Guidance for AI coding agents (and people) working in this repository. Keep it short and true; update it in the same PR as the change it describes.

## What this is

Watchwright is a browser test harness on the Playwright library. A long-lived server runs test packs in its own run engine (not `npx playwright test`), streams a live screencast to its web page, and exposes every action through an HTTP API (and through a CLI and an MCP server). The base design (plugins, engine, store, API) is [docs/plan.md](docs/plan.md); the plan for the current step is [docs/plans/step-5.md](docs/plans/step-5.md). Read both before adding a feature.

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

- `packages/watchwright/src/core/` — the plugin contract (`definePlugin` with `setup`, then `ready` once every plugin is set up; typed services through `serviceKey`; `pages` a plugin brings to the web app's menu), the built-in plugin list and the `core` plugin (`/health`, `GET /actions`, `GET /events`, `POST /stop`).
- `packages/watchwright/src/actions/` — the action registry: an action declares name, method, path and JSON Schema input, and for agents `agent: { tool, say }` (an MCP tool) and `destructive`; HTTP routes, CLI commands and MCP tools are generated from it.
- `packages/watchwright/src/events/` — the event log (cursor, bounded wait, subscribe).
- `packages/watchwright/src/session/` — browser sessions (launch, contexts, screencast).
- `packages/watchwright/src/jobs/` — the job kind contract (`kind.ts`: plan, helpers, classify, outcome labels), the registry plugins add kinds to (`kinds.ts`, the runs plugin's `JOB_KINDS` service), the runtime every attempt gets (`runtime.ts`), run control (pause, stop, broken waits) and the recorder for artifacts.
- `packages/watchwright/src/plugins/` — `settings` (machine-wide preferences other plugins declare, `GET`/`POST /settings`), `approvals` (the gate for `destructive` actions: from anything but the web page they wait for the person to approve them there), `live` (frame hub, WebSocket), `folders` (folder listing for the web app's folder browser, recent folders, open in the file manager), `packs` (esbuild loader, test ordering, discover, move, starter pack), `runs` (engine, results, files; provides `JOB_KINDS` and starts queued runs in `ready`, after every plugin registered its kinds), `reviews` (rubric snapshots, reviews, compare, Markdown and zip export), `editor` (a pack's files for the web app's editor: list, read, save with a stale check, create, rename, delete), `record` (recording sessions: a browser driven from the live view, Playwright's recorder turning its actions into YAML steps, other targets for each step; agents explore in the same sessions with steps and aria refs, in `explore.ts`), `testing` (registers the `test` job kind: `h` helpers, outcomes; loaded after `runs`), `agents` (the MCP server at `/api/v1/mcp`: tools made from actions with `agent.tool`, in `tools.ts`, shared with the CLI's stdio bridge `watchwright mcp`; who called lately; `agents.install`, which writes the skill and MCP settings into a project, in `install.ts`).
- `packages/watchwright/src/server/` — Fastify app: mounts plugins under `/api/v1`, the request guard, the web app with SPA fallback.
- `packages/watchwright/src/store/` — SQLite through better-sqlite3, migrations per plugin.
- `packages/watchwright/src/cli/` — the `watchwright` command: `serve`, the commands for people and agents (`status`, `run`, `wait`, `results`), `mcp` (the stdio MCP bridge), `init-agent` (the skill and MCP settings into a project, locally), and one generated command per action, talking to the server over HTTP.
- `packages/web/` — Vue 3 + Vite web app; `vite build` writes into `packages/watchwright/dist/web`. The menu comes from the pages in `GET /health` (`src/pages.ts`); a new page needs its view in `App.vue` and its `pages` entry on the plugin.
- `packages/watchwright/skill/watchwright/` — the agent skill shipped in the package: `SKILL.md` by hand, `references/` made from the docs site's pages by `pnpm --filter watchwright skill-references` (a test fails when they are stale; rerun it after changing those pages).
- `packages/site/` — the docs site (VitePress): landing page, `guide/`, `reference/`. Built on every PR by `.github/workflows/site.yml`.

## Conventions

- **General, not for one site.** Watchwright is a general tester; the Wildcard Pipeline bench is only its first pack. Nothing site-specific goes into Watchwright. When a pack needs something, build the general seam here and keep the site's details in the pack.
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
- Each release also publishes the docs site to GitHub Pages (https://dumiflex.github.io/watchwright/). To publish `main` without a release, run the Site workflow on `main` by hand.
