import { afterEach, describe, expect, it, vi } from "vitest";
import { pageGate, session, signOut } from "../src/session";

const admin = { id: "u1", name: "dumi", displayName: null, role: "admin" as const, via: "session" as const };

describe("pageGate", () => {
  it("shows public pages whatever the session", () => {
    expect(pageGate(true, false, { loaded: false, on: true, user: null })).toBe("public");
  });

  it("shows nothing until the server first answered", () => {
    expect(pageGate(false, false, { loaded: false, on: false, user: null })).toBe("wait");
  });

  it("shows the sign-in page when login is on and nobody is signed in", () => {
    expect(pageGate(false, true, { loaded: true, on: true, user: null })).toBe("signin");
  });

  it("shows the app when signed in, with login off, or when the server didn't answer", () => {
    expect(pageGate(false, true, { loaded: true, on: true, user: admin })).toBe("app");
    expect(pageGate(false, true, { loaded: true, on: false, user: null })).toBe("app");
    expect(pageGate(false, true, { loaded: false, on: false, user: null })).toBe("app");
  });
});

describe("signOut", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps the page as it is and reloads it at the start", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(url);
      return new Response(JSON.stringify({ data: {} }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const loc = { hash: "#/runs", reload: vi.fn() };
    vi.stubGlobal("location", loc);
    Object.assign(session, { loaded: true, on: true, user: admin });
    await signOut();
    expect(calls).toEqual(["/api/v1/auth/signout"]);
    // Nulling the user first showed the sign-in page before the reload.
    expect(session.user).toEqual(admin);
    expect(loc.hash).toBe("#/");
    expect(loc.reload).toHaveBeenCalledOnce();
  });
});
