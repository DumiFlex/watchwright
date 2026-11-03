import { BlockList, isIP } from "node:net";
import * as oidc from "openid-client";
import { ActionError } from "../../actions/registry.js";
import { ROLES, type Role } from "../../core/access.js";

// Single sign-on (docs/plans/self-hosting.md, section 2.6): OpenID Connect, which covers VoidAuth,
// Authentik, Authelia, Pocket ID, Keycloak and the like, and a trusted header set by a reverse
// proxy that already does forward auth. Both make or find an account by who the provider says the
// person is, and give it a role from the person's groups.

export interface SsoSettings {
  oidc: {
    on: boolean;
    /** What the sign-in button says: "Sign in with <name>". */
    name: string;
    issuer: string;
    clientId: string;
    /** Never answered by the API; empty for a public client. */
    clientSecret: string;
    scopes: string;
    /** The claim (in the ID token or from userinfo) that lists the person's groups. */
    groupsClaim: string;
  };
  header: {
    on: boolean;
    /** The header with the user name, such as Remote-User. */
    user: string;
    /** The header with the groups, comma or pipe separated; empty: none. */
    groups: string;
    /** Addresses (or ranges, `172.18.0.0/16`) of the proxy; the header counts only from these. */
    from: string[];
  };
  /** Group → role. The highest role of the person's groups wins. */
  roles: { group: string; role: Role }[];
  /** Role for someone whose groups match no mapping; `none` refuses them. */
  otherRole: Role | "none";
  /** Everyone may sign in with a password too; off: only admins (so a broken provider can't lock them out). */
  passwords: boolean;
}

export const DEFAULT_SSO: SsoSettings = {
  oidc: { on: false, name: "", issuer: "", clientId: "", clientSecret: "", scopes: "openid profile email groups", groupsClaim: "groups" },
  header: { on: false, user: "Remote-User", groups: "Remote-Groups", from: [] },
  roles: [],
  otherRole: "viewer",
  passwords: true,
};

/** The settings as the API answers them: the client secret only as whether there is one. */
export function publicSso(s: SsoSettings) {
  const { clientSecret, ...rest } = s.oidc;
  return { ...s, oidc: { ...rest, hasSecret: clientSecret !== "" } };
}

const str = (v: unknown, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** New settings from an admin's input over the current ones; throws on what can't work. A missing `clientSecret` keeps the current one. */
export function mergeSso(current: SsoSettings, input: Record<string, unknown>): SsoSettings {
  const o = (input.oidc ?? {}) as Record<string, unknown>;
  const h = (input.header ?? {}) as Record<string, unknown>;
  const next: SsoSettings = {
    oidc: {
      on: o.on === undefined ? current.oidc.on : o.on === true,
      name: o.name === undefined ? current.oidc.name : str(o.name, 60),
      issuer: o.issuer === undefined ? current.oidc.issuer : str(o.issuer),
      clientId: o.clientId === undefined ? current.oidc.clientId : str(o.clientId),
      clientSecret: o.clientSecret === undefined ? current.oidc.clientSecret : str(o.clientSecret, 2000),
      scopes: o.scopes === undefined ? current.oidc.scopes : str(o.scopes) || DEFAULT_SSO.oidc.scopes,
      groupsClaim: o.groupsClaim === undefined ? current.oidc.groupsClaim : str(o.groupsClaim, 100),
    },
    header: {
      on: h.on === undefined ? current.header.on : h.on === true,
      user: h.user === undefined ? current.header.user : str(h.user, 100),
      groups: h.groups === undefined ? current.header.groups : str(h.groups, 100),
      from: h.from === undefined ? current.header.from : Array.isArray(h.from) ? h.from.map((x) => str(x, 64)).filter(Boolean) : [],
    },
    roles:
      input.roles === undefined
        ? current.roles
        : Array.isArray(input.roles)
          ? input.roles
              .map((r) => ({ group: str((r as { group?: unknown }).group, 200), role: (r as { role?: unknown }).role as Role }))
              .filter((r) => r.group !== "")
          : [],
    otherRole: input.otherRole === undefined ? current.otherRole : (input.otherRole as Role | "none"),
    passwords: input.passwords === undefined ? current.passwords : input.passwords === true,
  };
  for (const r of next.roles) if (!ROLES.includes(r.role)) throw new ActionError("bad_input", `A role is one of ${ROLES.join(", ")}, not ${String(r.role)}.`);
  if (next.otherRole !== "none" && !ROLES.includes(next.otherRole)) throw new ActionError("bad_input", `The role for anyone else is none or one of ${ROLES.join(", ")}.`);
  if (next.oidc.on) {
    if (!next.oidc.name) throw new ActionError("bad_input", "Give the provider a name for the sign-in button, such as VoidAuth.");
    let url: URL;
    try {
      url = new URL(next.oidc.issuer);
    } catch {
      throw new ActionError("bad_input", "The issuer is the provider's address, such as https://auth.example.com.");
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new ActionError("bad_input", "The issuer's address starts with https://.");
    if (!next.oidc.clientId) throw new ActionError("bad_input", "Give the client id the provider made for Watchwright.");
  }
  if (next.header.on) {
    if (!/^[A-Za-z0-9-]+$/.test(next.header.user)) throw new ActionError("bad_input", "The user header is a header name, such as Remote-User.");
    if (next.header.groups && !/^[A-Za-z0-9-]+$/.test(next.header.groups)) throw new ActionError("bad_input", "The groups header is a header name, such as Remote-Groups.");
    if (next.header.from.length === 0) throw new ActionError("bad_input", "Say which proxy the header comes from (its address or range): from anywhere else it is refused.");
    peerTest(next.header.from);
  }
  return next;
}

/** What a person's groups give them. `keep`: an existing account keeps its role (there is no mapping to go by). */
export function roleFromGroups(s: SsoSettings, groups: readonly string[], existing: boolean): { role: Role | null; refused: boolean } {
  const have = new Set(groups.map((g) => g.toLowerCase()));
  let best = -1;
  for (const r of s.roles) if (have.has(r.group.toLowerCase())) best = Math.max(best, ROLES.indexOf(r.role));
  if (best >= 0) return { role: ROLES[best]!, refused: false };
  if (s.roles.length === 0 && existing) return { role: null, refused: false };
  if (s.otherRole === "none") return { role: null, refused: true };
  return { role: s.otherRole, refused: false };
}

/** Groups from a claim or header value: a list, or a string split on commas, pipes or spaces. */
export function groupsOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((g): g is string => typeof g === "string" && g !== "");
  if (typeof value === "string") return value.split(/[,|\s]+/).filter(Boolean);
  return [];
}

/** A test for "does this address belong to the proxy", from addresses and ranges. */
export function peerTest(from: readonly string[]): (ip: string | undefined) => boolean {
  const list = new BlockList();
  for (const entry of from) {
    const [addr = "", bits] = entry.split("/");
    const type = isIP(addr) === 6 ? "ipv6" : isIP(addr) === 4 ? "ipv4" : null;
    if (!type) throw new ActionError("bad_input", `"${entry}" isn't an address or a range (such as 172.18.0.0/16).`);
    if (bits === undefined) list.addAddress(addr, type);
    else {
      const n = Number(bits);
      if (!Number.isInteger(n) || n < 0 || n > (type === "ipv4" ? 32 : 128)) throw new ActionError("bad_input", `"${entry}" has a range that doesn't fit.`);
      list.addSubnet(addr, n, type);
    }
  }
  return (ip) => {
    if (!ip) return false;
    const plain = ip.startsWith("::ffff:") && isIP(ip.slice(7)) === 4 ? ip.slice(7) : ip;
    const type = isIP(plain) === 6 ? "ipv6" : "ipv4";
    return isIP(plain) !== 0 && list.check(plain, type);
  };
}

/** A sign-in on its way through the provider: kept by its `state` for ten minutes. */
interface Pending {
  verifier: string;
  nonce: string;
  redirectUri: string;
  at: number;
  /** Linking from Your account: the account the identity goes to. */
  linkUser?: string | undefined;
}

const PENDING_MS = 10 * 60_000;
const PENDING_MAX = 1000;

export interface OidcPerson {
  subject: string;
  name: string;
  displayName: string | null;
  groups: string[];
  /** Set when the sign-in was started to link the identity to this account. */
  linkUser?: string | undefined;
}

/** The OpenID Connect side: the provider's settings (fetched once per issuer and client), sign-ins in progress. */
export class OidcClient {
  private found: { key: string; config: Promise<oidc.Configuration> } | null = null;
  private readonly pending = new Map<string, Pending>();

  /** The provider's configuration from its discovery document. Plain http works too, for providers on a home network. */
  configuration(s: SsoSettings["oidc"]): Promise<oidc.Configuration> {
    const key = JSON.stringify([s.issuer, s.clientId, s.clientSecret]);
    if (this.found?.key !== key) {
      const insecure = s.issuer.startsWith("http:");
      const config = oidc.discovery(new URL(s.issuer), s.clientId, s.clientSecret || undefined, s.clientSecret ? oidc.ClientSecretPost(s.clientSecret) : oidc.None(), insecure ? { execute: [oidc.allowInsecureRequests] } : undefined);
      // A failed discovery isn't kept, so the next sign-in tries again.
      config.catch(() => {
        if (this.found?.key === key) this.found = null;
      });
      this.found = { key, config };
    }
    return this.found.config;
  }

  /** Where to send the browser to sign in, and the `state` that comes back with it. */
  async start(s: SsoSettings["oidc"], redirectUri: string, linkUser?: string): Promise<{ url: string; state: string }> {
    const config = await this.configuration(s);
    const verifier = oidc.randomPKCECodeVerifier();
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const now = Date.now();
    for (const [k, p] of this.pending) if (now - p.at > PENDING_MS || this.pending.size >= PENDING_MAX) this.pending.delete(k);
    this.pending.set(state, { verifier, nonce, redirectUri, at: now, linkUser });
    const url = oidc.buildAuthorizationUrl(config, {
      redirect_uri: redirectUri,
      scope: s.scopes,
      state,
      nonce,
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
      code_challenge_method: "S256",
    });
    return { url: url.href, state };
  }

  /** Who the provider says signed in, from the callback's address (with `code` and `state`). */
  async finish(s: SsoSettings["oidc"], query: URLSearchParams, state: string): Promise<OidcPerson> {
    const pending = this.pending.get(state);
    this.pending.delete(state);
    if (!pending || Date.now() - pending.at > PENDING_MS) throw new Error("This sign-in took too long or was already used. Try again.");
    const config = await this.configuration(s);
    const back = new URL(pending.redirectUri);
    back.search = query.toString();
    const tokens = await oidc.authorizationCodeGrant(config, back, { pkceCodeVerifier: pending.verifier, expectedState: state, expectedNonce: pending.nonce, idTokenExpected: true });
    const claims = tokens.claims();
    if (!claims) throw new Error("The provider sent no ID token.");
    let info: Record<string, unknown> = { ...claims };
    // Groups (and names) are often only in userinfo.
    if ((s.groupsClaim && info[s.groupsClaim] === undefined) || info.preferred_username === undefined) {
      try {
        info = { ...(await oidc.fetchUserInfo(config, tokens.access_token, claims.sub)), ...info };
      } catch {
        // Not every provider has userinfo; the ID token's claims are enough.
      }
    }
    const text = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
    const email = text(info.email);
    const name = text(info.preferred_username) ?? (email ? email.split("@")[0]! : null) ?? text(info.name) ?? claims.sub;
    return { subject: `${claims.iss} ${claims.sub}`, name, displayName: text(info.name), groups: s.groupsClaim ? groupsOf(info[s.groupsClaim]) : [], ...(pending.linkUser ? { linkUser: pending.linkUser } : {}) };
  }
}
