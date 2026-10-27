import { describe, expect, it } from "vitest";
import { buildErrorSpot, editorUrl, firstOwnFrame } from "../src/editor";

describe("editor links", () => {
  it("builds each editor's URL, at a line and column", () => {
    expect(editorUrl("vscode", "/home/sam/shop/tests/a.ts", 4, 9)).toBe("vscode://file/home/sam/shop/tests/a.ts:4:9");
    expect(editorUrl("cursor", "C:\\Users\\sam\\my shop\\a.ts", 2)).toBe("cursor://file/C:/Users/sam/my%20shop/a.ts:2");
    expect(editorUrl("idea", "/srv/a.ts", 3)).toBe("idea://open?file=%2Fsrv%2Fa.ts&line=3");
    expect(editorUrl("windsurf", "/srv/a.ts")).toBe("windsurf://file/srv/a.ts");
    expect(editorUrl("none", "/srv/a.ts", 1)).toBeNull();
  });

  it("reads the spot of a build error", () => {
    expect(buildErrorSpot('tests/b.ts:4:12 Unexpected ";"')).toEqual({ spot: { file: "tests/b.ts", line: 4, column: 12 }, rest: 'Unexpected ";"' });
    expect(buildErrorSpot("The pack has no tests.")).toBeNull();
  });

  it("finds the first stack frame in the person's own code", () => {
    const stack = [
      "Error: boom",
      "    at Object.body (/home/sam/sites/shop/tests/b.ts:4:9)",
      "    at async Object.execute (file:///opt/watchwright/dist/plugins/testing/kind.js:29:9)",
    ].join("\n");
    expect(firstOwnFrame(stack)).toEqual({ file: "/home/sam/sites/shop/tests/b.ts", line: 4, column: 9 });
    const deps = ["Error: x", "    at f (/app/node_modules/playwright-core/lib/a.js:1:2)", "    at g (C:\\sites\\shop\\tests\\c.ts:7:3)"].join("\n");
    expect(firstOwnFrame(deps)).toEqual({ file: "C:\\sites\\shop\\tests\\c.ts", line: 7, column: 3 });
    expect(firstOwnFrame("Error: boom\n    at Object.body (C:/Users/sam/shop/tests/a.ts:3:9)")).toEqual({ file: "C:\\Users\\sam\\shop\\tests\\a.ts", line: 3, column: 9 });
    expect(firstOwnFrame("Error: x\n    at node:internal/process:1:1")).toBeNull();
  });
});
