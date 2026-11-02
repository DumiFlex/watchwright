# Teams, and dashboards for different audiences

Dumi asked on 2 November 2026, right after [dashboards](../plans/dashboards.md) shipped:

- should Watchwright have **teams** (or groups of people)?
- can a pack have **more than one dashboard**, each meant for a different audience, for example one for privileged people and a public one?

This note says what is there now, what each would take, and recommends a design. Nothing is built yet.

## What is there now

- **One dashboard per pack.** It comes from the pack's `dashboard:` block, or from a change made on the page (Customize), kept in the `dashboards` table, one row per pack, until someone resets it.
- **Public is a per-tile switch.** Every tile has `public` (true by default). The public status page (`#/status`) shows a pack's tiles that are public and of a kind that makes sense there; a shared run shows the public tiles for that one run. The pack's `share:` block keeps texts, metrics, reviews or named outputs out of every public place.
- **Three roles**, `viewer` < `user` < `admin` (`core/access.ts`). Every signed-in person sees every pack and every run; roles only decide what someone may *do*. Single sign-on maps the provider's groups to one of these roles (`auth/sso.ts`, `roleFromGroups`); the groups themselves are not kept.
- **Who changes what.** Customize (`dashboards.save`) needs `user`. Turning the status page on, picking its packs and whether it shows tiles needs `admin` (Settings › Sharing today; Admin › Sharing after the Settings split).
- **Pack code is server access.** A pack runs as code on the server (`pack.ts`, `h` helpers), and a `user` can edit packs in the editor. Anyone who can edit a pack can read anything the server can. The self-hosting research said this already: roles can't fence in someone who edits packs.

Two things follow that matter for both questions:

1. With login on, a "privileged" dashboard can't hide numbers from a viewer: the viewer can open every run those numbers come from. Only the line between signed in and **public** is a real line today.
2. A public tile today is "every tile unless someone said no". Anyone with `user` can make a tile public in Customize, and it reaches the status page as soon as an admin has turned on tiles there.

## Question 1: more than one dashboard per pack

### What people want from it

- **A public one that is made for the public**: a few clear tiles (pass rate, duration, the leaderboard), written for strangers, instead of the team's dashboard with the noisy tiles switched off one by one.
- **A team one** with everything: unreviewed attempts, lowest scores, failures, outputs.
- Sometimes **more than one team view** of the same pack: "models" for the person tuning prompts, "health" for whoever watches the smoke runs. This is about focus, not secrecy.

### Recommended design: named dashboards with an audience

A pack can have several dashboards. Each has a **name** and an **audience**, which reuses the access levels the server already has:

| Audience | Who sees it |
|---|---|
| `public` | everyone, including the status page and shared runs |
| `viewer` (default) | anyone signed in |
| `user` | users and admins |
| `admin` | admins |

In the pack file:

```yaml
dashboards:
  - name: Team
    runs: 40
    groups:
      - title: Models
        tiles:
          - { leaderboard: model, columns: [score.quality, metric.AI s, flags.finding], width: 4 }
      - title: To look at
        tiles:
          - { unreviewed: true }
          - { lowest: quality, width: 2 }
  - name: Public
    audience: public
    runs: 20
    tiles:
      - { outcome: true, width: 2 }
      - { leaderboard: model, columns: [score.quality, runs], width: 2 }
```

- **`dashboard:` keeps working** as it is: one dashboard named "Dashboard" for `viewer`, whose `public` tiles are what the public sees, exactly as now. A pack writes `dashboard:` or `dashboards:`, not both. Nothing existing breaks and no pack has to change.
- **Once a pack has a `public` dashboard, that is what the public gets**, and the per-tile `public` switch is no longer read for that pack. One way to say "public" per pack, not two that fight.
- **Dashboards made on the page.** Customize gets **New dashboard** (name, audience, start empty or from a copy) next to editing one. Dashboards made on the page are kept on the server like today's override; ones from the pack file can be changed and reset to the pack's, as now. The `dashboards` table gets a second migration: the key becomes (pack, dashboard name), with a column for where it came from (pack change or made on the page) and its audience.
- **The server filters, not the page.** `GET /packs/:id/dashboards` lists only the dashboards the caller may see; `GET /packs/:id/dashboard?name=` refuses one above the caller's role (403). The `pack_dashboard` MCP tool gets an optional `name`.
- **Who may change what.** Making or changing a dashboard needs `user`, as now, except that anything whose audience is `public` (making one, editing one, or moving one to `public`) needs `admin`. Publishing is an admin decision already (Admin › Sharing), and this closes the gap where a user's Customize change reaches the status page.

Where they show:

- **Pack page and runs list for one pack**: a tab row (the kit's segmented control) when there is more than one dashboard the person may see; the last one picked is remembered per pack in the browser. One dashboard: no tabs, as now.
- **Status page**: each pack shows its `public` dashboard. A pack with none falls back to today's public tiles. Admin › Sharing lets an admin pick which public dashboard a pack shows if it has several.
- **Shared runs**: the run tiles come from the pack's public dashboard (or today's public tiles).

### Cost

About three PRs, all inside the `dashboards`, `packs` and `shares` plugins and the web dashboard components, with no new concepts on the server: the pack format and store (migration 2, list action, audience checks, MCP `name`); the web tabs and New dashboard in Customize; the status page and shares reading the public dashboard, docs and screenshots.

## Question 2: teams

"Teams" can mean two different things, and they cost very different amounts.

### a. Groups as a label: who a dashboard is for

A dashboard's audience could name a **group** ("QA", "Prompt team") instead of a role: it's listed first or shown as their default. Groups would come from the sign-in provider (the groups single sign-on already reads and today throws away after picking a role) or be made in Settings › Users. This is cheap, but it only changes what people see first. Since every signed-in person can open every run, it can't keep anything from anyone, and calling it "access" would mislead.

### b. Teams as a boundary: a team sees only its own packs

This is what "teams" usually means in a hosted tool: packs belong to a team, and a person sees only their teams' packs, runs, files, schedules, alerts and dashboards. It would mean:

- an owner on every pack and, through it, every run, attempt, file, review, schedule, alert rule, saved sign-in, secret and share;
- a check on **every** read: runs, results, files, the event log and its WebSocket, the live view, `GET /actions`, folder browsing, the MCP tools, `watchwright status`, exports and the runs list's tiles. Missing one is a leak, and the event log and live frames are easy to miss;
- secrets and saved sign-ins per team, or a person in one team could run a pack with another team's password;
- runners per team, or one team could reach another's sites through its runner.

And it still wouldn't hold for anyone who can **edit packs**: pack code runs on the server and can read the database and every team's files. A real boundary would need packs to run in a sandbox (a separate process per team with no access to the server's data, or a container per run). That is a different product from a self-hosted tester for one person or a small group.

## Who can run code on the server today

Dumi asked: upload is admin-only because pack code runs on the server, so what stops a user from editing an admin's pack to add bad code? Today, nothing. With login on, these all need only `user` (the default for a state change):

| Action | What it lets a user do |
|---|---|
| `packs.file-save`, `packs.file-create`, `packs.file-rename` (editor, `write_pack_file`) | write `pack.ts` or any `.ts`/`.js` file in any pack; the next run executes it |
| `packs.convert-test` | turn a YAML test into code |
| `packs.add`, `packs.create`, `packs.discover`, `packs.move` | add a folder as a pack (in server mode, within `WATCHWRIGHT_FOLDERS`), so code already there runs |

The self-hosting plan chose this on purpose ("Users can run code on this server through packs. Give this role only to people you trust with it."), but upload being admin-only while editing is not makes the rule look stronger than it is, and it blocks any honest per-pack access.

A YAML pack is data: `pack.yaml` and YAML tests are read by the built-in step runner (`packs/yaml/run.ts`) and run no code of the pack's own. That gives a clean line:

- **Code is admin-only.** Writing, creating or renaming a code file (`.ts`, `.tsx`, `.js`, `.mjs`, `.cjs`, `.jsx`, `package.json`, and anything under `node_modules`), converting a YAML test to code, and adding, creating, discovering or moving packs need `admin`. Upload already does.
- **Users keep everything that isn't code.** Running, reviewing, recording, editing YAML tests and `pack.yaml`, rubric and data files (`.json`, `.csv`, `.md`, images), schedules and dashboards. Recording already writes YAML.
- **What it changes in the web app:** for a user, the editor opens code files read-only with a note ("Only admins change code"), New file offers YAML and data files, and Add pack / Upload / New pack are admin-only. The Users page's text for `user` changes from "can run code on this server" to "can run and edit tests, not code".

This is a fix to an existing feature (FIX FIRST), about one PR, and it is what makes pack access below mean something for users.

## Users propose code, admins review it

Making code admin-only shouldn't stop a user from improving a pack's code: it should route the change through an admin. The web app already has the part that shows it: `DiffView` (one column or two, changed parts marked, unchanged stretches folded), used today for the editor's "changed on disk" conflict and on `#/kit`.

**How it works**

- **In the editor**, a user who changes a code file gets **Propose change** instead of **Save**. Several files can go into one proposal (edit `pack.ts` and a helper, then propose both), with a short note ("Wait for the toast before clicking Save"). Until it's sent, the draft stays in the browser like an unsent message; once sent, it's on the server.
- **What is kept:** a `proposals` table in a new `proposals` plugin, with the pack, who proposed it, the note, when, and per file: path, the text it was based on (its hash and the text, for the diff) and the new text. Creating, renaming and deleting a code file can be proposed too.
- **Admins review it** in a **Changes to review** list (Admin, plus a count on the pack page and in the top bar like approvals): each file as a `DiffView` against the version it was based on, then **Apply** or **Decline** with a reply. Apply writes the files with the editor's stale check: if a file changed on disk since the proposal, the admin sees a three-way choice (theirs, the proposal, or open it in the editor to merge), never a silent overwrite. After apply, the pack reloads and shows its problems, as a save does today.
- **The person who proposed it** sees its state (waiting, applied, declined, with the reply) in the editor and in a list of their proposals, and can withdraw or update it while it waits (updating keeps one proposal, with its history).
- **Agents:** `write_pack_file` from a user's token, on a code file, answers "proposed for review, id …" instead of failing, and a `wait_for_review` like `wait_for_approval` lets an agent wait for the answer. An admin's token writes directly, as now.
- **Events and alerts:** `proposal.created`, `proposal.applied`, `proposal.declined` in the event log, so an alert rule can ping admins on ntfy/Discord when a change waits.
- **Later, not in the first build:** **Run with this change** for an admin, which runs the pack from a copy with the proposal applied, so the admin can try it before it lands. It runs the proposed code, so only an admin can start it.

**Why not reuse approvals?** Approvals hold one call from an agent for the same person to allow on the web page, and expire in minutes. A proposal is different: a different person answers it (an admin), it holds several files, it can wait days, and it needs a diff and a stale check. It can share the approvals list's look and the top-bar count.

Cost: about two PRs on top of "code is admin-only" (server: plugin, actions, MCP, events; web: Propose in the editor, the review list with `DiffView`, screenshots).

## Pack access (Dumi expects to need it soon)

With code admin-only, a smaller form of (b) holds for viewers **and** users: an admin decides who sees each pack.

- **Per pack: everyone (default) or chosen people and groups.** Set in the pack's menu (**Access…**) and listed in Admin › Users. Groups are the sign-in provider's groups (kept on the account at sign-in instead of thrown away) or local groups an admin makes. Admins see every pack.
- **Role stays separate:** what you may do (viewer/user/admin) is your role; which packs you see is pack access. A viewer with access to pack A can look at A's runs; a user with access can run and edit A's tests.
- **Everything that belongs to a pack follows it:** runs, attempts, files, reviews, shares, schedules, the event log and its WebSocket (events of hidden packs are left out), the live view, dashboards, exports, the MCP tools and the CLI. Server-wide things (secrets, saved sign-ins, runners, alerts) stay admin-managed; a pack can be limited to some of them later if needed.
- **One check, one place.** A `PACK_ACCESS` service answers "may this caller see pack X" and "which packs may this caller see"; every plugin calls it, and a test in the spirit of the route inventory in `test/auth.test.ts` fails when an action or route that reads pack data doesn't. Hidden packs answer `not_found`, not `forbidden`, so their names don't leak.
- **Login off:** everything is visible, as now.

What it still doesn't do: an admin's pack code can read anything (admins are trusted), and a pack's code can't be limited per user. Real separation of code would need a sandbox per pack, which stays out.

Cost: about three PRs after the code fix: the access store and service with the checks in runs, results, files and events; the web (Access dialog, Users page, filtered lists) and the MCP/CLI; docs and screenshots. Named dashboards could then also take a group as an audience.

## Recommendation on teams

Don't build full teams. Build, in this order:

1. **Code is admin-only** (one PR, a fix, now).
2. **Users propose code changes, admins review them** (about two PRs, right after, so users don't lose anything they could do).
3. **Only admins publish tiles** (one small PR, a fix, now).
4. **Pack access** (about three PRs), since Dumi expects other people on the server soon.
5. **Named dashboards with an audience** (about three PRs), with groups as an audience once pack access has them.

## Now or later

Items 1 and 3 close gaps in what already shipped, so they fit FIX FIRST. Items 2, 4 and 5 are new work on features that exist (login, dashboards), not new capabilities; recommended after the open audit fixes and the Settings split (which moves Sharing to Admin › Sharing and reworks Users, where pack access would show).

## Questions for Dumi

1. Make code admin-only (users keep YAML tests, data and runs), with users proposing code changes for an admin to review?
2. Make the "only admins publish tiles" fix now?
3. Pack access as above (per pack: everyone, or chosen people and groups) before named dashboards?

## Decided

- 2 November 2026: Dumi chose **code is admin-only, with users proposing code changes for admins to review**. The code fix is built first; proposals follow. Checking the code for it also found that a YAML test's `upload` step takes any path on the server and its `goto` (and a recording's address) can open `file:` addresses; the code fix closes both, since without that a YAML test could still read server files.
