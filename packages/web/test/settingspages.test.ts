import { afterEach, describe, expect, it } from "vitest";
import { session, type Role } from "../src/session";
import { movedTo, sectionHref, sectionsOn } from "../src/settingspages";

function as(role: Role | null) {
  Object.assign(session, { loaded: true, on: role !== null, user: role ? { id: "u1", name: "u", displayName: null, role, via: "session" } : null });
}
const ids = (page: "account" | "settings" | "admin") => sectionsOn(page).map((s) => s.id);

afterEach(() => as(null));

describe("settings pages", () => {
  it("with login off: no account page, personal sections on Settings, the server's on Admin", () => {
    as(null);
    expect(ids("account")).toEqual([]);
    expect(ids("settings")).toEqual(["look", "notify", "editor", "newrun", "agents", "about"]);
    expect(ids("admin")).toEqual(["secrets", "signins", "runners", "runs", "packs", "sharing", "alerts", "storage", "recent", "server"]);
    expect(sectionsOn("admin")[0]!.group).toBe("Runs and packs");
  });

  it("gives admins people, single sign-on and defaults too", () => {
    as("admin");
    expect(ids("account")).toEqual(["account", "password", "tokens"]);
    expect(ids("admin").slice(0, 3)).toEqual(["users", "sso", "defaults"]);
    expect(ids("settings")).not.toContain("secrets");
  });

  it("shows users the server sections they may use on Settings, under one heading", () => {
    as("user");
    expect(ids("admin")).toEqual([]);
    expect(ids("settings")).toEqual(["look", "notify", "editor", "newrun", "agents", "secrets", "signins", "runners", "sharing", "storage", "recent", "about"]);
    expect(sectionsOn("settings").filter((s) => s.group).map((s) => [s.id, s.group])).toEqual([["secrets", "On this server"]]);
  });

  it("shows viewers their own preferences and the runners", () => {
    as("viewer");
    expect(ids("settings")).toEqual(["look", "notify", "editor", "runners", "about"]);
  });

  it("links to a section where it is for this person, and moves old links there", () => {
    as("admin");
    expect(sectionHref("storage")).toBe("#/admin?section=storage");
    expect(sectionHref("tokens")).toBe("#/account?section=tokens");
    expect(movedTo("settings", "server")).toBe("admin");
    expect(movedTo("settings", "account")).toBe("account");
    expect(movedTo("settings", "look")).toBeNull();
    as("user");
    expect(sectionHref("storage")).toBe("#/settings?section=storage");
    expect(movedTo("settings", "storage")).toBeNull();
    expect(movedTo("settings", "server")).toBeNull();
  });
});
