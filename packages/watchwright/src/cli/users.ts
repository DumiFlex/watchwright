import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { parseArgs } from "node:util";
import { ActionError } from "../actions/registry.js";
import { BUILTIN_PLUGINS } from "../core/builtin.js";
import { ROLES, type Role } from "../core/access.js";
import { migrationsOf } from "../core/plugin.js";
import { resolveDataDir } from "../config.js";
import { AuthStore } from "../plugins/auth/store.js";
import { openStore } from "../store/db.js";

// `watchwright users`: accounts for login, made on the machine the server runs on (in Docker:
// `docker exec`). It works on the data folder itself, so it works with the server stopped, and it
// is the way back in when every admin has forgotten their password (docs/plans/self-hosting.md, 2.2).

export const USERS_HELP = `Usage:
  watchwright users list
  watchwright users add <name> [--role admin|user|viewer] [--password-stdin]
  watchwright users reset-password <name> [--password-stdin]
  watchwright users role <name> <admin|user|viewer>
  watchwright users disable <name>
  watchwright users enable <name>
  watchwright users remove <name>

Works on the data folder (--data, else WATCHWRIGHT_DATA, else the OS's app data folder), with or
without the server running. Passwords are asked for at the terminal, or read from the first line
of standard input with --password-stdin. The role is user unless given.`;

export interface UsersIo {
  out: (s: string) => void;
  err: (s: string) => void;
  /** Asks for a password without showing it; null when there is no terminal. */
  password: (prompt: string) => Promise<string | null>;
  /** The first line of standard input. */
  stdinLine: () => Promise<string>;
}

export async function usersCommand(argv: string[], io: UsersIo = usersIo): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { data: { type: "string" }, role: { type: "string" }, "password-stdin": { type: "boolean" }, help: { type: "boolean", short: "h" } },
  });
  const [verb, name, extra] = positionals;
  if (values.help || !verb) {
    io.out(USERS_HELP);
    return values.help ? 0 : 2;
  }
  const store = openStore(resolveDataDir({ flag: values.data }), migrationsOf(BUILTIN_PLUGINS));
  const auth = new AuthStore(store.db);
  const askPassword = async (): Promise<string | null> => {
    if (values["password-stdin"]) return (await io.stdinLine()).replace(/\r?\n$/, "");
    const first = await io.password("Password: ");
    if (first === null) {
      io.err("No terminal to ask for the password. Pipe it in with --password-stdin.");
      return null;
    }
    const again = await io.password("Same password again: ");
    if (again !== first) {
      io.err("The two passwords aren't the same.");
      return null;
    }
    return first;
  };
  const find = (n: string | undefined) => {
    const u = n ? auth.byName(n) : null;
    if (!u) io.err(n ? `There is no user named ${n}.` : "Name the user.");
    return u;
  };
  try {
    switch (verb) {
      case "list": {
        const users = auth.users();
        if (users.length === 0) io.out("No users yet. Add the first admin with: watchwright users add <name> --role admin");
        for (const u of users) io.out(`${u.name.padEnd(24)} ${u.role.padEnd(7)} ${u.disabled ? "disabled " : ""}${u.source === "local" ? "" : `(${u.source}) `}last seen ${u.seenAt ?? "never"}`);
        return 0;
      }
      case "add": {
        if (!name) return usage(io, "Name the user: watchwright users add <name>");
        const role = (values.role ?? "user") as Role;
        if (!ROLES.includes(role)) return usage(io, `--role is one of ${ROLES.join(", ")}.`);
        const password = await askPassword();
        if (password === null) return 1;
        const u = await auth.add({ name, password, role });
        io.out(`Added ${u.name} (${u.role}).`);
        return 0;
      }
      case "reset-password": {
        const u = find(name);
        if (!u) return 1;
        const password = await askPassword();
        if (password === null) return 1;
        await auth.update(u.id, { password });
        auth.endSessions(u.id);
        io.out(`New password set for ${u.name}; their sign-ins have ended.`);
        return 0;
      }
      case "role": {
        const u = find(name);
        if (!u) return 1;
        if (!extra || !ROLES.includes(extra as Role)) return usage(io, `The role is one of ${ROLES.join(", ")}.`);
        await auth.update(u.id, { role: extra as Role });
        io.out(`${u.name} is now ${extra === "admin" ? "an" : "a"} ${extra}.`);
        return 0;
      }
      case "disable":
      case "enable": {
        const u = find(name);
        if (!u) return 1;
        await auth.update(u.id, { disabled: verb === "disable" });
        io.out(`${u.name} ${verb === "disable" ? "can't sign in any more; their sign-ins have ended" : "can sign in again"}.`);
        return 0;
      }
      case "remove": {
        const u = find(name);
        if (!u) return 1;
        auth.remove(u.id);
        io.out(`Removed ${u.name}.`);
        return 0;
      }
      default:
        return usage(io, `There is no users command "${verb}".`);
    }
  } catch (err) {
    if (err instanceof ActionError) {
      io.err(err.message);
      return 1;
    }
    throw err;
  } finally {
    store.close();
  }
}

function usage(io: UsersIo, message: string): number {
  io.err(`${message}\n\n${USERS_HELP}`);
  return 2;
}

export const usersIo: UsersIo = {
  out: (s) => process.stdout.write(`${s}\n`),
  err: (s) => process.stderr.write(`${s}\n`),
  async password(prompt) {
    if (!process.stdin.isTTY) return null;
    process.stdout.write(prompt);
    // Echo nothing while the password is typed.
    const muted = new Writable({ write: (_chunk, _enc, done) => done() });
    const rl = createInterface({ input: process.stdin, output: muted, terminal: true });
    try {
      return await rl.question("");
    } finally {
      rl.close();
      process.stdout.write("\n");
    }
  },
  async stdinLine() {
    const rl = createInterface({ input: process.stdin });
    try {
      for await (const line of rl) return line;
      return "";
    } finally {
      rl.close();
    }
  },
};
