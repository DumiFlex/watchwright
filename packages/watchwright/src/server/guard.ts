// Request guard: a server on 127.0.0.1 is still reachable from any web page open in the same
// browser (a form post, or a DNS-rebinding page that then reads the answers). So every request
// must name us in its Host header, and a request that changes something or opens a WebSocket
// must come from our own origin when it says where it comes from. A server people reach at other
// addresses (--public-url, docs/plans/self-hosting.md, section 2.1) adds those, and only those.

const LOCAL_NAMES = ["127.0.0.1", "localhost", "[::1]"];

/** The extra hosts and origins the public addresses allow: `watchwright.home.lan` and `https://watchwright.home.lan`. */
export interface PublicAddresses {
  hosts: readonly string[];
  origins: readonly string[];
}

export const NO_PUBLIC: PublicAddresses = { hosts: [], origins: [] };

/** Hosts and origins from --public-url values; throws on one that isn't an http(s) address. */
export function publicAddresses(urls: readonly string[]): PublicAddresses {
  const hosts: string[] = [];
  const origins: string[] = [];
  for (const raw of urls) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new Error(`--public-url "${raw}" isn't an address like https://watchwright.example.lan`);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`--public-url "${raw}" must start with http:// or https://`);
    hosts.push(url.host.toLowerCase());
    origins.push(url.origin.toLowerCase());
  }
  return { hosts, origins };
}

/** True when the Host header is one of our loopback names with our port, or a public address's host. */
export function isAllowedHost(host: string | undefined, port: number, extra: PublicAddresses = NO_PUBLIC): boolean {
  if (!host) return false;
  const h = host.toLowerCase();
  return LOCAL_NAMES.some((name) => h === `${name}:${port}`) || extra.hosts.includes(h);
}

/** True when there is no Origin header (curl, scripts, agents), it is our own origin, or a public address's. */
export function isAllowedOrigin(origin: string | undefined, port: number, extra: PublicAddresses = NO_PUBLIC): boolean {
  if (origin === undefined) return true;
  const o = origin.toLowerCase();
  return LOCAL_NAMES.some((name) => o === `http://${name}:${port}`) || extra.origins.includes(o);
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function needsOriginCheck(method: string, isUpgrade: boolean): boolean {
  return isUpgrade || !SAFE_METHODS.has(method.toUpperCase());
}
