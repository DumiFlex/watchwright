// What a runner may open on its machine, decided on that machine (docs/plans/self-hosting.md,
// section 6.2). Entries: `loopback` (any port on localhost, 127.0.0.0/8 or ::1), `host:port`, or
// `host:*`. Hosts compare without case; `localhost`, `127.0.0.1` and `[::1]` count as one.

export const DEFAULT_ALLOW = ["loopback"];

const LOOPBACK = /^(localhost|127(\.\d{1,3}){3}|::1|\[::1\])$/i;

export function isLoopback(host: string): boolean {
  return LOOPBACK.test(host);
}

/** Splits and checks an allow list as typed (`loopback`, `localhost:3000, 192.168.1.20:8188`). Throws on a bad entry. */
export function parseAllow(input: string | readonly string[]): string[] {
  const parts = (typeof input === "string" ? input.split(/[,\s]+/) : input).map((p) => p.trim().toLowerCase()).filter(Boolean);
  for (const p of parts) {
    if (p === "loopback") continue;
    const m = /^(\[[0-9a-f:]+\]|[a-z0-9.-]+):(\d{1,5}|\*)$/.exec(p);
    if (!m || (m[2] !== "*" && (Number(m[2]) < 1 || Number(m[2]) > 65535))) throw new Error(`"${p}" isn't loopback, host:port or host:*.`);
  }
  return parts.length ? [...new Set(parts)] : [...DEFAULT_ALLOW];
}

export function allows(list: readonly string[], host: string, port: number): boolean {
  const h = host.toLowerCase().replace(/^\[(.*)\]$/, "$1");
  const same = (a: string) => {
    const x = a.replace(/^\[(.*)\]$/, "$1");
    return x === h || (isLoopback(x) && isLoopback(h));
  };
  return list.some((entry) => {
    if (entry === "loopback") return isLoopback(h);
    const i = entry.lastIndexOf(":");
    const eh = entry.slice(0, i);
    const ep = entry.slice(i + 1);
    return same(eh) && (ep === "*" || Number(ep) === port);
  });
}
