# Linking single sign-on to existing accounts

Status: research note, then built in the same PR.

## The problem

A server that had password accounts before single sign-on was turned on gets a second account for each person the first time they sign in through the provider. Signing in with VoidAuth as `DumiFlex` made `DumiFlex-2`, an admin next to the password account `DumiFlex`, with its own tokens, settings and "seen" time.

That is how Watchwright 0.13 is built, not a provider problem:

- An account is found by `users.source` + `users.subject` (for OpenID Connect `"<issuer> <sub>"`, for the trusted header the lower-cased user name). Each account holds at most one such pair.
- A password account has `source = 'local'` and no subject, and nothing can give it one.
- When the pair is unknown, `AuthStore.external` makes a new account, named after `preferred_username` with `-2`, `-3`… when the name is taken.

## What people need

1. Sign in with the provider and land in the account they already have.
2. Do that without opening a way for someone else to take an account over.
3. Clean up duplicates that already exist (like `DumiFlex-2`).
4. See and remove the sign-ins linked to an account, without locking themselves out.

## Ways to match an identity to an account

| Way | Safe? | Notes |
|---|---|---|
| Same verified email | Only when both sides have a verified email | Watchwright accounts have no email at all, so there is nothing to match against. Adding emails just to match is a bigger change (and still means trusting the provider's `email_verified`, which some self-hosted providers set loosely). |
| Same user name, automatically | **No** | Many providers (VoidAuth with open sign-up, Authentik enrolment flows, Pocket ID) let people choose their own user name. Whoever registers `boss` at the provider first would get the admin `boss` here. This is the classic account-takeover hole that Grafana, Gitea and Nextcloud keep behind an off-by-default switch. |
| Same user name, **after the account's password** | Yes | The person proves both: the provider vouches for the identity, the password for the account. Gitea's "Link to an existing account" screen does exactly this. |
| Link while signed in | Yes | The person is already in the account (session cookie) and then proves the identity at the provider. GitHub, GitLab and Grafana do this from the profile page. |
| An admin moves a sign-in | Yes | The admin already controls every account. Covers duplicates made before linking existed, and the trusted header (which can't do the redirect dance). |

## Recommendation

Build the three safe ways; leave automatic matching out.

**Identities as their own table.** Migration 5 adds `auth_identities (id, source, subject, user_id, name, created_at, used_at)`, unique on `(source, subject)`, and copies every account's current pair into it. An account can then have several (a password, an OpenID Connect identity, a header name). `users.source` stays as how the account was first made; `users.subject` is no longer read.

**1. Sign-in that meets a taken name.** When the provider vouches for an unknown identity and an enabled account with a password already has the name it would get, Watchwright doesn't make `name-2`. It keeps the identity for ten minutes, server side, behind an HttpOnly cookie (`ww_link`), and the sign-in page asks:

- *Link to your account:* the account's name and password. Wrong passwords count against the same throttle as signing in. On success the identity is linked and the person signed in. This works even when passwords are off for non-admins, since the provider's sign-in is the other half of the proof.
- *Make a separate account:* today's behaviour (`name-2`), for a different person who happens to share the name.

An account without a password (made by the provider or the header) can't be proven this way, so it is never offered.

**2. Link from Your account.** A new **Single sign-on** card lists the account's linked sign-ins, with **Link VoidAuth** (the button name). It runs the normal OpenID Connect sign-in with the account's id kept beside the `state`; the callback links the identity only when the browser is still signed in to that same account. An identity already linked to another account is refused with a message to ask an admin.

**3. Admin merge.** In Admin › Users, **Merge into another account** moves an account's linked sign-ins and API tokens to the account chosen, then removes it (a destructive action: from agents it waits for approval on the page). Runs, reviews and proposals keep the name they were made under. The removed account's own preferences don't move. The last admin can't be merged into a non-admin. The same is in the offline CLI as `watchwright users merge <from> <into>`, for when nobody can sign in.

**Removing a linked sign-in** is allowed for the account's owner and admins, unless it is the account's only way in (no password and no other sign-in).

**Groups and roles** keep working as before: whichever account the identity is linked to gets the role and groups from the provider at each sign-in.

## Cleaning up a duplicate today

With this built: sign in as the account to keep (password), open Admin › Users and merge the duplicate into it. Next time **Sign in with VoidAuth** lands in the kept account. Deleting the duplicate without linking only makes it again at the next provider sign-in.

## Not built

- Automatic linking by name or email (see the table). Can come later as an admin switch with a warning, if someone needs it.
- Linking the trusted header from Your account: the proxy signs every request in as the header's user, so there is no moment where the person is in two accounts. An admin merge covers it.
