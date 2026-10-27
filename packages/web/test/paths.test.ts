import { describe, expect, it } from "vitest";
import { commonPrefix, completionTarget, crumbs, headTail, join, matchNames, rootOf, sepOf, tildify } from "../src/paths";

describe("paths", () => {
  it("knows Windows and POSIX roots and separators", () => {
    expect(rootOf("C:\\Users\\sam")).toBe("C:\\");
    expect(rootOf("c:/sites")).toBe("c:\\");
    expect(rootOf("\\\\nas\\share\\packs")).toBe("\\\\nas\\share\\");
    expect(rootOf("/home/sam")).toBe("/");
    expect(rootOf("sites/shop")).toBe("");
    expect(sepOf("C:\\a")).toBe("\\");
    expect(sepOf("/a/b")).toBe("/");
  });

  it("splits a path into crumbs from the root", () => {
    expect(crumbs("C:\\Users\\sam")).toEqual([
      { label: "C:", path: "C:\\" },
      { label: "Users", path: "C:\\Users" },
      { label: "sam", path: "C:\\Users\\sam" },
    ]);
    expect(crumbs("/srv/shop")).toEqual([
      { label: "/", path: "/" },
      { label: "srv", path: "/srv" },
      { label: "shop", path: "/srv/shop" },
    ]);
    expect(crumbs("/")).toEqual([{ label: "/", path: "/" }]);
  });

  it("shows the home folder as ~ only at a folder boundary", () => {
    expect(tildify("/home/sam/sites", "/home/sam")).toBe("~/sites");
    expect(tildify("/home/sam", "/home/sam")).toBe("~");
    expect(tildify("/home/samuel", "/home/sam")).toBe("/home/samuel");
    expect(tildify("c:\\users\\sam\\x", "C:\\Users\\sam")).toBe("~\\x");
    expect(tildify("/srv", null)).toBe("/srv");
  });

  it("keeps the last folder apart for display", () => {
    expect(headTail("~/sites/shop/watchwright")).toEqual({ head: "~/sites/shop/", tail: "watchwright" });
    expect(headTail("C:\\")).toEqual({ head: "", tail: "C:\\" });
  });

  it("finds what a half-typed path asks to complete", () => {
    expect(completionTarget("/home/sam/si")).toEqual({ dir: "/home/sam", partial: "si" });
    expect(completionTarget("/home/sam/")).toEqual({ dir: "/home/sam", partial: "" });
    expect(completionTarget("/ho")).toEqual({ dir: "/", partial: "ho" });
    expect(completionTarget('"C:\\Users\\s')).toEqual({ dir: "C:\\Users", partial: "s" });
    expect(completionTarget("C:\\")).toEqual({ dir: "C:\\", partial: "" });
    expect(completionTarget("~/si")).toEqual({ dir: "~", partial: "si" });
    expect(completionTarget("sites/shop")).toBeNull();
    expect(completionTarget("C:")).toBeNull();
  });

  it("matches and completes names like a terminal", () => {
    expect(matchNames(["Sites", "src", "notes"], "s")).toEqual(["Sites", "src"]);
    expect(commonPrefix(["watchwright", "watch-old"])).toBe("watch");
    expect(commonPrefix(["one"])).toBe("one");
    expect(commonPrefix([])).toBe("");
    expect(join("C:\\", "sites")).toBe("C:\\sites");
    expect(join("/home/sam", "sites")).toBe("/home/sam/sites");
  });
});
