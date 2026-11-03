# Single sign-on

With [login](./safety#login) on, people can sign in with the account they already have instead of a Watchwright password. Two ways are built in:

- **OpenID Connect.** Watchwright talks to your sign-in provider itself: VoidAuth, Authentik, Authelia, Pocket ID, Keycloak, and any other OpenID Connect provider. The sign-in page gets a **Sign in with …** button. Nothing changes in your reverse proxy.
- **A trusted header.** Your reverse proxy signs people in itself (forward auth) and passes their name on in a header, such as `Remote-User`. Watchwright believes that header only when it comes from the proxy.

Both are set up by an admin in **Admin › Single sign-on**. An account is made the first time someone signs in, and gets its role from their groups. Someone who already has an account here can [link](#linking-to-an-account-you-already-have) the two instead.

## OpenID Connect

1. In your provider, make a client (also called an app or application) for Watchwright:
   - **Redirect address:** `https://<your Watchwright address>/api/v1/auth/oidc/callback`. Admin › Single sign-on shows it with a copy button, for the address you opened the page at. Behind a reverse proxy, start the server with [`--public-url`](../reference/cli#serve) so this address is the one people use.
   - **Type:** confidential, with a client secret, using the authorization code flow. Public clients without a secret work too; Watchwright always uses PKCE.
   - **Scopes:** `openid profile email groups`, or whichever give the person's name and groups.
2. In Admin › Single sign-on, turn on **Sign in with an OpenID Connect provider**. Fill in:
   - the button name, such as VoidAuth;
   - the issuer, which is the provider's address (its settings are at `<issuer>/.well-known/openid-configuration`);
   - the client id and secret.
3. Save. Watchwright asks the provider for its settings first, and says so when it doesn't answer.

People are matched by the provider and their subject (the provider's id for them). Their user name here is the provider's `preferred_username`, else the start of their email address.

## Linking to an account you already have

A sign-in from the provider is linked to one account here. The first time someone signs in, Watchwright looks for an account linked to them, and makes one when there is none. On a server that had password accounts before single sign-on was turned on, link the two instead, so people keep their account, tokens and settings. There are three ways:

- **When the name is taken.** If the provider's user name is already an account here with a password, the sign-in page asks: *Link your account* with that account's password, or *Make a separate account* (named like `name-2`) for someone else who happens to share the name. After linking, **Sign in with …** opens that account directly. Wrong passwords count against the same limits as signing in.
- **From Your account.** Signed in with your password, open **Your account › Single sign-on** and choose **Link …**. You sign in at the provider and come back to your account. A provider sign-in that already has its own account here can't be linked this way: an admin merges it.
- **An admin merges two accounts.** In **Admin › Users**, the merge button on an account moves its single sign-on links and API tokens to the account you keep, then removes it. Runs and reviews keep the name they were made under; its own preferences don't move. Use it to clean up a duplicate made before linking, such as `dumi-2` next to `dumi`. Merging the account you're signed in as signs you out; sign in again and you land in the account kept. On the server, `watchwright users merge <name> <into>` does the same (see [users](../reference/cli#users)).

Watchwright never links by name or email on its own. Many providers let people choose their own user name, so whoever registered `admin` there first would get the admin account here. Linking always takes proof of both: the provider's sign-in, and the account's password or an admin.

**Your account › Single sign-on** lists the sign-ins linked to your account, and unlinks one. An account's only way in can't be unlinked: set a password first (an account made by single sign-on can set one on the same page).

The trusted header can't be linked from Your account, since the proxy signs every request in as the header's user. An admin merges those accounts instead.

### Roles from groups

Under **Roles from groups**, list groups with the role each gives, such as `watchwright-admins` → Admin and `watchwright` → User. Someone in several groups gets the highest role. **Anyone else who signs in** sets the role for people in none of them. **No access** turns them away.

With groups listed, the role is set again at every sign-in, so changes in the provider carry over. With none listed, a new account gets the role for anyone else, and after that an admin changes it in Settings › Users.

The groups come from the claim named under **Groups claim** (`groups` by default), in the ID token or from the provider's userinfo.

The groups are also kept on the account at each sign-in, so a pack kept to a group (see [Pack access](./safety#pack-access)) follows the provider too.

### Provider notes

| Provider | Issuer | Groups |
|---|---|---|
| **VoidAuth** | VoidAuth's address followed by `/oidc`, such as `https://auth.example.com/oidc` (shown as OIDC Issuer Endpoint in VoidAuth's OIDC info) | Ask for the `groups` scope. |
| **Authentik** | `https://authentik.example.com/application/o/<application slug>/` | In the `groups` claim of the default `profile` scope. |
| **Authelia** | Authelia's address. Add the client under `identity_providers.oidc.clients`, with the redirect address in `redirect_uris`. | Ask for the `groups` scope. |
| **Pocket ID** | Pocket ID's address | Ask for the `groups` scope. |
| **Keycloak** | `https://keycloak.example.com/realms/<realm>` | Add a group membership mapper with claim name `groups`, and **Full group path** off. |

A provider on a home network without https works too (an issuer starting with `http://`), but use https wherever people sign in over a network you don't trust.

## Trusted header (forward auth)

When your reverse proxy already signs people in, such as Authelia or Authentik's proxy outpost with nginx `auth_request`, Traefik `forwardAuth` or Caddy `forward_auth`, it can pass the person's name on. Turn on **Trust a header from the reverse proxy** and fill in:

- **User header:** the header with the user name. Authelia sets `Remote-User`, Authentik `X-authentik-username`, and Tailscale Serve `Tailscale-User-Login`.
- **Groups header** (optional): the header with the groups, separated by commas, pipes or spaces. Authelia uses `Remote-Groups`, Authentik `X-authentik-groups`.
- **Proxy address:** the proxy's address or range, such as `172.18.0.0/16` for a Docker network.

::: warning Only the proxy may set it
Anyone who can reach Watchwright without going through the proxy could send the header themselves. That's why the header counts only from the proxy address. From anywhere else the request is refused, and an `auth.header-refused` event is logged. Make sure Watchwright's port is reachable only through the proxy.
:::

The groups map to roles the same way as with OpenID Connect, and count for pack access too.

## Passwords

People with a password can still sign in with it, so an admin is never locked out when the provider is down. To make everyone else use single sign-on, turn off **Everyone may also sign in with a password**. Admins can then still use a password, through **Admin? Sign in with a password** on the sign-in page.

When nobody can get in at all, `watchwright users` on the server's machine still works (see [users](../reference/cli#users)).

The CLI and agents use [API tokens](../reference/cli#login) whichever way people sign in. Someone who signs in with single sign-on makes a token on **Your account** (the user menu) and gives it to `watchwright login --token`.
