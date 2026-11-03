# Pack access

Status: parts 1 (the server) and 2 (the page and groups) built. Decided in [research/teams-and-audience-dashboards.md](../research/teams-and-audience-dashboards.md).

With login on, an admin can keep a pack to chosen people and groups. Everyone else on the server doesn't see it: not in lists, not by id, not in the event stream. Without a rule a pack is open to everyone signed in, as before. With login off nothing changes.

## Rules

- **Per pack: everyone (default) or chosen people and groups.** Admins always see every pack.
- **Role stays separate.** What you may do is your role (viewer, user, admin); which packs you see is pack access. A viewer let into pack A reads A's runs; a user let in also runs and edits A's tests.
- **Everything in a pack follows it:** runs, attempts, files, reviews, compare and exports, dashboards, schedules, presets, proposals, recordings, share links (the link itself keeps working for whoever has it), approvals of calls that reach the pack, the event log and the live view.
- **Hidden means missing.** A call that names something in a hidden pack answers `404 not_found`, worded as for a thing that doesn't exist, so a pack's name doesn't leak.
- **Server-wide things stay as they are:** secrets, saved sign-ins, runners, alerts, settings and storage totals are admin-managed and not per pack.

## How it is built

- `packs` plugin migration 2: `packs_access (pack_id, people, groups, updated_by, updated_at)`; a row means "chosen".
- `PackAccessStore` (`plugins/packs/access.ts`) answers `sees(user, packId)`, `hiddenFrom(user)` and `hidesEvent(user, event)`. It is the `PACK_ACCESS` service and, through the `PackGuard` interface, the core's `PACK_GUARD`.
- **Every action states its `pack` scope** (`actions/registry.ts`):
  - `"none"`: it reads no pack's data (settings, users, secrets…).
  - `"list"`: it lists across packs and filters with `call.sees` itself (runs, packs, schedules…).
  - `{ <kind>: "<input field>" }`: the field names a thing of that kind (`{ run: "id" }`, `{ pack: "packId" }`). `invokeAction` asks the resolver registered for the kind which pack it is in, and refuses the call before the handler runs. Plugins register resolvers with `PACK_ACCESS.resolve(kind, fn)` in `setup`: `pack`, `run`, `preset`, `proposal`, `schedule`, `recording`, `share`.
- **Every plain route states `config.pack`:** `"checked"` (it checks `PACK_ACCESS` itself: run files, pack images and downloads, exports, live frames, the live WebSocket) or `"none"`.
- `test/pack-access.test.ts` fails when an action or a non-public route doesn't say, the same way `test/auth.test.ts` does for access levels.
- Groups come from `CallUser.groups`: auth migration 4 adds `users.groups` (set by an admin, `POST /auth/users/:id { groups }`) and `users.sso_groups` (the provider's or proxy header's groups, replaced at each sign-in); a person's groups are both, matched without regard to case.

## API

| Route | |
|---|---|
| `GET /packs/:id/access` | `{ mode: "everyone" }` or `{ mode: "chosen", people, groups, updatedBy, updatedAt }` (admin). |
| `POST /packs/:id/access` `{ mode, people?, groups? }` | Sets it (admin). `people` are user ids, `groups` group names. Emits `pack.access_changed`. |
| `GET /packs/access` | Every kept pack's rule by pack id (admin), for the packs list and Admin › Users. |

## Parts

1. **The server**: the store, the guard, scopes on every action and route, lists and events filtered, the two routes above, tests and docs.
2. **The page and groups** (this too): a **Who sees this pack…** item in the pack's menu (everyone, or people and groups picked from the users and groups the server knows), the pack's access shown in Admin › Users, and groups: the sign-in provider's groups kept on the account at each sign-in, plus groups an admin sets on a user.
3. **Named dashboards with an audience** build on it (see the research note).
