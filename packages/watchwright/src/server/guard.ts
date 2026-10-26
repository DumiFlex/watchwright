// Request guard: a server on 127.0.0.1 is still reachable from any web page open in the same
// browser (a form post, or a DNS-rebinding page that then reads the answers). So every request
// must name us in its Host header, and a request that changes something or opens a WebSocket
// must come from our own origin when it says where it comes from.

const LOCAL_NAMES = ["127.0.0.1", "localhost", "[::1]"];

/** True when the Host header is one of our loopback names with our port. */
export function isAllowedHost(host: string | undefined, port: number): boolean {
  if (!host) return false;
  return LOCAL_NAMES.some((name) => host.toLowerCase() === `${name}:${port}`);
}

/** True when there is no Origin header (curl, scripts, agents) or it is our own origin. */
export function isAllowedOrigin(origin: string | undefined, port: number): boolean {
  if (origin === undefined) return true;
  return LOCAL_NAMES.some((name) => origin.toLowerCase() === `http://${name}:${port}`);
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function needsOriginCheck(method: string, isUpgrade: boolean): boolean {
  return isUpgrade || !SAFE_METHODS.has(method.toUpperCase());
}
