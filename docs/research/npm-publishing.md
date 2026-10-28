# Research: publishing Watchwright to npm

Status: built in `ci/npm-publish`. The first publish waits for the maintainer's npm setup (below).

## The question

Step 5 made `packages/watchwright` ready to publish (no `private`, a `files` list, the skill inside, a `bin`) but left publishing for later. How should every release reach npm, safely and without anyone's hands on it?

## What the package holds

`npm pack --dry-run` after `pnpm build` (version 0.6.0): 312 files, 1.8 MB packed, 4.3 MB unpacked.

- `dist/` — the server and CLI (JavaScript, `.d.ts` types, source maps), the JSON schemas for test and pack files, and the built web app (`dist/web`, about 2.8 MB, most of it CodeMirror and the Markdown chunks).
- `skill/watchwright/` — the agent skill and its references.
- `README.md`, `package.json`.
- **Missing before this change: `LICENSE` and `NOTICE`.** npm only adds a license file from the package's own folder, and both live at the repository root. A `prepack` script now copies them in (they are git-ignored there), and `NOTICE` is in `files`.

Nothing that shouldn't ship: no sources, tests, fixtures, `.env`, local data or tokens. The only path-like strings are the made-up examples on the component kit page (`/home/sam/projects/...`). Installing the packed tarball into an empty project and running `npx watchwright serve` starts the server and serves the web page.

To keep it that way, `scripts/check-package.ts` (`pnpm --filter watchwright check-package`) reads `npm pack --dry-run --json` and fails when a needed file is missing (`LICENSE`, `NOTICE`, the CLI entry, the web app, the schemas, the skill), when a repository-only path slips in (`src/`, `test/`, `.watchwright/`, `.env`, `.npmrc`, databases, archives, keys), or when the package grows past 15 MB unpacked. CI runs it after every build, and the publish job runs it right before publishing.

## The name

`watchwright` and `watch-wright` are both free on the registry (404 on 2026-10-28). An unscoped name is the shortest to type (`npx watchwright`) and matches the command; a scope (`@dumiflex/watchwright`) would need an npm organization or user scope and makes `npx` longer. Unscoped it is.

## How to publish

| | Long-lived token in a secret | Trusted publishing (OIDC) |
|---|---|---|
| Secret to keep | `NPM_TOKEN`; write tokens now expire within 90 days | none |
| If the repo or a workflow leaks | the token publishes anything, from anywhere | only this workflow file in this repo can publish |
| Provenance | needs `--provenance` and `id-token: write` anyway | automatic for a public repo and package |
| Needs | nothing special | npm CLI 11.5.1+, Node 22.14+, GitHub-hosted runner, `id-token: write` |

Trusted publishing has been generally available since July 2025 and is what npm recommends. npm trusts one workflow file of one repository; at publish time the npm CLI trades the job's GitHub OIDC token for a short-lived publish token, and the registry signs a provenance statement (built by this repo's workflow from commit X) that shows on the package page and that `npm audit signatures` checks. After it works, the package can be set to "Require two-factor authentication and disallow tokens", so no token can publish it at all.

Points that shape the setup:

- **The package must exist before a trusted publisher can be added**, and OIDC can't do a package's first publish (npm/cli#8544). The usual way round: publish a tiny placeholder by hand once (version `0.0.0`), add the trusted publisher, let the workflow publish the first real version, then deprecate the placeholder.
- **A new trusted publisher expires if it hasn't published within 2 days**, so add it shortly before the release that should publish.
- **npm checks the calling workflow's file name.** A reusable workflow called from `release.yml` is checked as `release.yml`; a separate file run by hand would need a second trusted publisher. So the publish job lives in `release.yml` itself, and running Release by hand doubles as the retry.
- **Fields must match exactly** (case too): user `DumiFlex`, repository `watchwright`, workflow `release.yml`, and `repository.url` in `package.json` (`git+https://github.com/DumiFlex/watchwright.git`, already right). A mismatch only shows at publish time, as a 404 or `ENEEDAUTH`.
- **`actions/setup-node` with `registry-url` writes an `.npmrc` that expects `NODE_AUTH_TOKEN`**, which breaks OIDC; leave it out.
- Node 22 ships npm 10, so the job uses Node 24 and installs npm 11.
- pnpm can't be relied on for the OIDC exchange yet; the job builds with pnpm and publishes with `npm publish` from `packages/watchwright` (the package has no `workspace:` dependencies, so npm publishes it as is).
- A GitHub environment (with required reviewers) could gate each publish, but releases already wait for the dev→main merge, so it would only add a click. Left out; the trusted publisher's environment field stays empty.

## What was built

- `release.yml` gets an `npm` job after `release`: on a new release (or a manual run on `main`) it checks out the release tag, skips if that version is already on npm, installs, builds, runs `check-package` and runs `npm publish --access public` with `id-token: write`. Nothing else in the workflow gets the OIDC permission.
- `ci.yml` runs `check-package` after the build.
- `prepack` copies `LICENSE` and `NOTICE` in; `NOTICE` added to `files`.
- The docs (README, Getting started, Command line) say to install from npm, with the clone as the way to work on Watchwright itself. They go live with the release that publishes, since the docs site is published per release.

## What only the maintainer can do

1. Make an npm account with two-factor authentication (an organization isn't needed for an unscoped package).
2. Publish the placeholder `watchwright@0.0.0` by hand from a folder holding only a `package.json` (name, version, description, license, repository) and a one-line README.
3. On npmjs.com: package `watchwright` → Settings → Trusted publisher → GitHub Actions: `DumiFlex` / `watchwright` / `release.yml`, no environment.
4. Within 2 days, merge dev into main; the release it makes publishes the first real version with provenance.
5. Then deprecate `0.0.0` (`npm deprecate watchwright@0.0.0 "Placeholder; install the latest version."`) and set Publishing access to "Require two-factor authentication and disallow tokens".

## Sources

- npm docs, [Trusted publishing for npm packages](https://docs.npmjs.com/trusted-publishers/)
- GitHub changelog, [npm trusted publishing with OIDC is generally available](https://github.blog/changelog/2025-07-31-npm-trusted-publishing-with-oidc-is-generally-available/) (2025-07-31)
- GitHub community, [NPM publish using OIDC on GitHub Actions](https://github.com/orgs/community/discussions/176761) (404s from mismatched fields and a stale `NODE_AUTH_TOKEN`)
- npm/cli#8544, first publish through OIDC (open)
