import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { serveCommand } from "../src/cli/serve.js";
import { usersCommand, type UsersIo } from "../src/cli/users.js";
import { BUILTIN_PLUGINS } from "../src/core/builtin.js";
import { migrationsOf } from "../src/core/plugin.js";
import { AuthStore } from "../src/plugins/auth/store.js";
import { openStore } from "../src/store/db.js";

// `watchwright users` works on the data folder itself, with or without the server.

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function io(passwords: (string | null)[] = []) {
  const out: string[] = [];
  const err: string[] = [];
  const it: UsersIo = {
    out: (s) => out.push(s),
    err: (s) => err.push(s),
    password: async () => (passwords.length > 0 ? passwords.shift()! : null),
    stdinLine: async () => "piped password here\n",
  };
  return { it, out, err };
}

describe("watchwright users", () => {
  it("merges a single sign-on duplicate into the account to keep", async () => {
    const data = mkdtempSync(path.join(tmpdir(), "ww-users-"));
    dirs.push(data);
    expect(await usersCommand(["add", "dumi", "--role", "admin", "--password-stdin", "--data", data], io().it)).toBe(0);
    const store = openStore(data, migrationsOf(BUILTIN_PLUGINS));
    new AuthStore(store.db).external("oidc", "https://idp u-1", { name: "dumi" }, "admin");
    store.close();
    const list = io();
    await usersCommand(["list", "--data", data], list.it);
    expect(list.out.join("\n")).toMatch(/dumi-2\s+admin\s+\(oidc\)/);
    const m = io();
    expect(await usersCommand(["merge", "dumi-2", "dumi", "--data", data], m.it)).toBe(0);
    expect(m.out.join("\n")).toBe("Merged dumi-2 into dumi: 1 single sign-on link and 0 tokens moved, dumi-2 removed.");
    expect(await usersCommand(["merge", "dumi", "--data", data], io().it)).toBe(2);
    const after = openStore(data, migrationsOf(BUILTIN_PLUGINS));
    const auth = new AuthStore(after.db);
    expect(auth.users().map((u) => u.name)).toEqual(["dumi"]);
    expect(auth.bySubject("oidc", "https://idp u-1")?.name).toBe("dumi");
    after.close();
  });

  it("adds, lists, changes and removes users", async () => {
    const data = mkdtempSync(path.join(tmpdir(), "ww-users-"));
    dirs.push(data);
    const a = io(["a long password", "a long password"]);
    expect(await usersCommand(["add", "dumi", "--role", "admin", "--data", data], a.it)).toBe(0);
    expect(a.out.join("\n")).toContain("Added dumi (admin)");
    const b = io();
    expect(await usersCommand(["add", "val", "--role", "viewer", "--password-stdin", "--data", data], b.it)).toBe(0);
    const c = io();
    expect(await usersCommand(["list", "--data", data], c.it)).toBe(0);
    expect(c.out.join("\n")).toMatch(/dumi\s+admin/);
    expect(c.out.join("\n")).toMatch(/val\s+viewer/);
    expect(await usersCommand(["role", "val", "user", "--data", data], io().it)).toBe(0);
    const d = io();
    expect(await usersCommand(["role", "dumi", "user", "--data", data], d.it)).toBe(1);
    expect(d.err.join("\n")).toMatch(/only admin/);

    const store = openStore(data, migrationsOf(BUILTIN_PLUGINS));
    const auth = new AuthStore(store.db);
    expect(await auth.signIn("val", "piped password here")).toMatchObject({ role: "user" });
    store.close();

    const mismatch = io(["one long password", "another password"]);
    expect(await usersCommand(["reset-password", "val", "--data", data], mismatch.it)).toBe(1);
    expect(mismatch.err.join("\n")).toMatch(/aren't the same/);
    expect(await usersCommand(["remove", "val", "--data", data], io().it)).toBe(0);
    expect(await usersCommand(["add", "x", "--data", data], io([null]).it)).toBe(1);
    expect(await usersCommand(["nope", "--data", data], io().it)).toBe(2);
  });

  it("serve refuses another address without login", async () => {
    const data = mkdtempSync(path.join(tmpdir(), "ww-users-"));
    dirs.push(data);
    expect(await serveCommand(["--host", "0.0.0.0", "--data", data, "--no-open", "--port", "1"])).toBe(1);
  });
});
