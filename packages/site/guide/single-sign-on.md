# Single sign-on

With [login](./safety#login) on, people can sign in with the account they already have instead of a Watchwright password. Two ways are built in:

- **OpenID Connect.** Watchwright talks to your sign-in provider itself: VoidAuth, Authentik, Authelia, Pocket ID, Keycloak, and any other OpenID Connect provider. The sign-in page gets a **Sign in with …** button. Nothing changes in your reverse proxy.
- **A trusted header.** Your reverse proxy signs people in itself (forward auth) and passes their name on in a header, such as `Remote-User`. Watchwright believes that header only when it comes from the proxy.

Both are set up by an admin in **Admin › Single sign-on**. An account is made the first time someone signs in, and gets its role from their groups.

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
