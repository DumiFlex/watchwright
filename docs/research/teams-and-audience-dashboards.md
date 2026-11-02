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

### Recommendation on teams

Don't build teams now. Nothing in the project needs a boundary between groups of people yet; Dumi's server is one person plus public pages, and the line that matters (signed in vs public) is the one the audience design above makes cleaner. If a real multi-team server comes up later, start with (b) for viewers only (the one place it can hold), and keep groups-as-labels (a) as a small add-on to named dashboards if someone asks for "show the QA people this one first".

## Now or later

The FIX FIRST rule (2 November 2026) says no new capabilities until existing features are fixed. Named dashboards are not a new capability: they finish one that just shipped, and they fix a real gap (a `user` can publish tiles to the status page). Still, they are new work, so:

- **Recommended:** build named dashboards after the open fixes from the functional audit and the Settings split land (it moves the status page's settings to Admin › Sharing). It is about three PRs.
- **The one fix to make now**, as a small PR on its own: only an admin may turn a tile public, or change a public tile, through Customize. That closes the gap with the current design and doesn't wait for the rest.
- **Teams:** later, only if a multi-team server is a real need, and with a sandbox for pack code in the plan.

## Questions for Dumi

1. Go ahead with named dashboards with an audience (public, viewer, user, admin), after the fixes?
2. Make the "only admins publish tiles" fix now?
3. Is there a real case for teams today (other people on your server who must not see some packs)? If not, it stays out.
