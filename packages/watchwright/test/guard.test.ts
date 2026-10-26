import { describe, expect, it } from "vitest";
import { isAllowedHost, isAllowedOrigin, needsOriginCheck } from "../src/server/guard.js";

describe("request guard", () => {
  it("accepts loopback names with our port only", () => {
    expect(isAllowedHost("127.0.0.1:7420", 7420)).toBe(true);
    expect(isAllowedHost("localhost:7420", 7420)).toBe(true);
    expect(isAllowedHost("LOCALHOST:7420", 7420)).toBe(true);
    expect(isAllowedHost("[::1]:7420", 7420)).toBe(true);
    expect(isAllowedHost("127.0.0.1:7421", 7420)).toBe(false);
    expect(isAllowedHost("127.0.0.1", 7420)).toBe(false);
    expect(isAllowedHost("evil.example:7420", 7420)).toBe(false);
    expect(isAllowedHost(undefined, 7420)).toBe(false);
  });

  it("accepts no Origin or our own origin", () => {
    expect(isAllowedOrigin(undefined, 7420)).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1:7420", 7420)).toBe(true);
    expect(isAllowedOrigin("http://localhost:7420", 7420)).toBe(true);
    expect(isAllowedOrigin("https://evil.example", 7420)).toBe(false);
    expect(isAllowedOrigin("http://127.0.0.1:5173", 7420)).toBe(false);
    expect(isAllowedOrigin("null", 7420)).toBe(false);
  });

  it("checks Origin on changes and WebSocket upgrades, not on reads", () => {
    expect(needsOriginCheck("GET", false)).toBe(false);
    expect(needsOriginCheck("HEAD", false)).toBe(false);
    expect(needsOriginCheck("POST", false)).toBe(true);
    expect(needsOriginCheck("DELETE", false)).toBe(true);
    expect(needsOriginCheck("GET", true)).toBe(true);
  });
});
