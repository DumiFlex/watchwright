# Account, Settings and Admin pages

Research note, 2026-11-02. Status: built in the same PR.

## The problem

Settings is one long page with 17 sections. Since login landed it mixes three kinds of thing:

- **Who you are**: your account, password and API tokens. Only makes sense with login on.
- **Your preferences**: the look, notifications, the editor files open in, what New run starts from, connecting your agents.
- **The server**: users, single sign-on, secrets, saved sign-ins, sharing, runners, alerts, storage, recent folders, start at sign-in, updates, stopping the server.

Each section already hides itself from roles that can't use it, so an admin sees all 17 and a viewer sees a page whose shape changes with their role. The page also says "everything else is kept by the server", which makes the editor and New run choices one setting for every person on a shared server: one person picking Cursor changes the links for everybody.

## How other self-hosted tools split it

Gitea, Grafana, Portainer, Jellyfin and Nextcloud all draw the same three lines: a profile/account page (password, tokens, sessions), user preferences (theme, language, editor-ish choices) and a site/server administration area only admins reach. Admin areas group the server's own objects (users, auth, integrations) apart from what one person prefers. Tools that keep a single page (VS Code server, code-server) are single user. Watchwright now has both modes (login off on a PC, login on in a homelab), so it should follow the first group and still read well with one person.

## What goes where

| Section | Page | Why |
| --- | --- | --- |
| Your account, Password, API tokens | **Account** | About the signed-in person. Only with login on. |
| Look and mode, Notifications | **Settings** | Kept by this browser, as today. |
| Editor | **Settings**, per user | The editor must be installed on the computer you browse from, so it is personal. |
| New run starts from | **Settings**, per user | A habit of how one person works. |
| Agents | **Settings** | Connecting your own agents with your own token. |
| About | **Settings** | For everyone. |
| Users, Single sign-on | **Admin** | Admin only. |
| Secrets, Sign-ins, Sharing, Runners, Storage, Recent folders | **Admin** for admins | Server objects. People who aren't admins still see the parts they could see before (secret names, saved sign-ins, their share links, runners, storage use, recent folders), on their Settings page under "On this server", so nothing they could do before goes away. |
| Alerts | **Admin** | Admin only. |
| Resume interrupted runs | **Admin › Runs** | The server's behaviour after a restart: one value for everyone. It moves out of "New run". |
| Start at sign-in, Updates, Stop | **Admin › Server** | Admin only. |
| Defaults for editor and New run | **Admin › Defaults** (login on) | What people who haven't chosen get. |

With login off there is one person, who is admin: the Account page doesn't exist, Settings holds the personal sections, and Admin holds the server ones. The editor and New run choices then write the server value directly, as before.

## Per-user settings

A setting a plugin defines can say `scope: "user"`. Its value is looked up in this order: the caller's own value, then the server value (Admin › Defaults), then the plugin's default. Own values live in a new table `settings_user (user_id, key, value)` (settings migration 2).

- `GET /settings` answers each value as it applies to the caller, plus `server` (the server-wide values) and each definition's `scope`.
- `POST /settings` (admin) changes server values, including the defaults of user settings. Unchanged.
- `POST /settings/mine` (viewer) changes the caller's own values of user settings only. With login off it changes the server value, since there is one person.

Existing values carry over: today's server value of `settings.editor` and `runs.newRunFrom` becomes the default for everyone until each person picks their own.

## Links and the menu

- New routes `#/account` and `#/admin`; both take `?section=`.
- Old links `#/settings?section=<id>` keep working: a section that now lives on another page opens there.
- The gear opens Settings. The user menu lists Your account, Settings, Admin (admins) and Sign out. Admin also shows in the menu and Ctrl+K for admins, and with login off.
- Pages carry an optional `access` role (`PluginPage.access`); the web app leaves out pages the person's role can't open.

## Left out

- Syncing the look and notifications per user across browsers: they stay in the browser, which is what a theme toggle on a shared PC expects.
- Per-user alerts (notify me when my runs fail): a real feature for later, not a page split.
