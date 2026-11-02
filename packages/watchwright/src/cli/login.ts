import os from "node:os";
import { parseArgs } from "node:util";
import { UsageError } from "./args.js";
import { serverUrl } from "./client.js";
import { credentialsPath, forgetLogin, saveLogin, savedLogin } from "./credentials.js";
import { usersIo, type UsersIo } from "./users.js";

// `watchwright login` and `watchwright logout` (docs/plans/self-hosting.md, section 3): signs in to
// a server with login on, makes an API token named after this machine, and saves it for that
// server, so the CLI and the stdio MCP bridge work without WATCHWRIGHT_TOKEN. `--token` saves a
// token made on the web page instead (for accounts that sign in through single sign-on).

export interface LoginIo extends UsersIo {
  /** A line typed at the terminal (the name); null without one. */
  ask: (prompt: string) => Promise<string | null>;
}

interface Envelope<T> {
  data?: T;
  error?: { code: string; message: string };
}

interface Me {
  on: boolean;
  user: { name: string; role: string; via: string; tokenId?: string } | null;
}

class LoginError extends Error {}

async function call<T>(base: string, method: string, path: string, opts: { body?: unknown; headers?: Record<string, string> } = {}): Promise<{ data: T; res: Response }> {
  let res: Response;
  try {
    res = await fetch(`${base}api/v1${path}`, {
      method,
      headers: {
        "x-watchwright-client": "cli",
        ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
        ...opts.headers,
      },
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new LoginError(`No Watchwright answers at ${base}.`);
  }
  const json = (await res.json().catch(() => null)) as Envelope<T> | null;
  if (!json) throw new LoginError(`Something that isn't Watchwright answers at ${base}.`);
  if (json.error) throw new LoginError(json.error.message);
  return { data: json.data as T, res };
}

/** The `ww_session` cookie a sign-in set, as a Cookie header value. */
function sessionCookie(res: Response): string | null {
  for (const c of res.headers.getSetCookie()) {
    const m = /^(ww_session=[^;]+)/.exec(c);
    if (m) return m[1]!;
  }
  return null;
}

const LOGIN_HELP = `Usage:
  watchwright login [--server <address>] [--name <name>] [--password-stdin] [--token <token>]
  watchwright logout [--server <address>]

login signs in to a server that has login on, makes an API token named after this machine, and
saves it in credentials.json in your config folder, for that server. The CLI and \`watchwright mcp\`
then send it by themselves (WATCHWRIGHT_TOKEN still wins). With --token it checks and saves a token
made on the web page instead. logout removes the token on the server and here.`;

export async function loginCommand(argv: string[], io: LoginIo = loginIo): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      server: { type: "string" },
      name: { type: "string" },
      token: { type: "string" },
      "password-stdin": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    io.out(LOGIN_HELP);
    return 0;
  }
  if (positionals.length) throw new UsageError(LOGIN_HELP);
  const base = serverUrl(values.server);
  try {
    const { data: me } = await call<Me>(base, "GET", "/auth/me");
    if (!me.on) {
      io.out(`Login is off on ${base}: the CLI needs no token there.`);
      return 0;
    }
    if (values.token !== undefined) {
      const token = values.token.trim();
      const { data: who } = await call<Me>(base, "GET", "/auth/me", {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!who.user) throw new LoginError("The server doesn't know this token. Make a new one in Settings › Your account.");
      saveLogin(base, {
        token,
        tokenId: who.user.tokenId ?? "",
        user: who.user.name,
        savedAt: new Date().toISOString(),
      });
      io.out(`Saved: signed in to ${base} as ${who.user.name} (${who.user.role}).`);
      return 0;
    }
    const name = values.name ?? (await io.ask("Name: "));
    if (!name?.trim()) {
      io.err("No terminal to ask for the name. Give it with --name.");
      return 2;
    }
    const password = values["password-stdin"] ? (await io.stdinLine()).replace(/\r?\n$/, "") : await io.password("Password: ");
    if (password === null) {
      io.err("No terminal to ask for the password. Pipe it in with --password-stdin.");
      return 2;
    }
    const signin = await call<{ user: { name: string; role: string } }>(base, "POST", "/auth/signin", { body: { name: name.trim(), password } });
    const cookie = sessionCookie(signin.res);
    if (!cookie) throw new LoginError("The server signed you in but sent no session cookie.");
    const headers = { cookie };
    try {
      const { data: made } = await call<{
        id: string;
        token: string;
        name: string;
      }>(base, "POST", "/auth/tokens", {
        headers,
        body: { name: `CLI on ${os.hostname()}`.slice(0, 80) },
      });
      saveLogin(base, {
        token: made.token,
        tokenId: made.id,
        user: signin.data.user.name,
        savedAt: new Date().toISOString(),
      });
      io.out(`Signed in to ${base} as ${signin.data.user.name} (${signin.data.user.role}). The token "${made.name}" is saved in ${credentialsPath()}.`);
    } finally {
      // The token is what stays; the sign-in that made it ends.
      await call(base, "POST", "/auth/signout", { headers }).catch(() => undefined);
    }
    return 0;
  } catch (err) {
    if (err instanceof LoginError) {
      io.err(err.message);
      return 1;
    }
    throw err;
  }
}

export async function logoutCommand(argv: string[], io: LoginIo = loginIo): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      server: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    io.out(LOGIN_HELP);
    return 0;
  }
  if (positionals.length) throw new UsageError(LOGIN_HELP);
  const base = serverUrl(values.server);
  const saved = savedLogin(base);
  if (!saved) {
    io.out(`Not signed in to ${base} on this machine.`);
    return 0;
  }
  let note = "";
  try {
    const auth = { authorization: `Bearer ${saved.token}` };
    const id = saved.tokenId || (await call<Me>(base, "GET", "/auth/me", { headers: auth })).data.user?.tokenId;
    if (!id) throw new LoginError("the server doesn't know the token any more");
    await call(base, "DELETE", `/auth/tokens/${encodeURIComponent(id)}`, {
      headers: auth,
    });
  } catch (err) {
    if (!(err instanceof LoginError)) throw err;
    note = ` The token wasn't removed on the server (${err.message}); remove it in Settings › Your account if it's still there.`;
  }
  forgetLogin(base);
  io.out(`Signed out of ${base} on this machine.${note}`);
  return 0;
}

export const loginIo: LoginIo = {
  ...usersIo,
  async ask(prompt) {
    if (!process.stdin.isTTY) return null;
    const { createInterface } = await import("node:readline/promises");
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    try {
      return await rl.question(prompt);
    } finally {
      rl.close();
    }
  },
};
