import { describe, expect, it } from "vitest";
import { wantsVideo } from "../src/livevideo";

describe("which live views come as a video stream", () => {
  it("auto asks for one only away from the server's own machine", () => {
    expect(wantsVideo("auto", "localhost")).toBe(false);
    expect(wantsVideo("auto", "127.0.0.1")).toBe(false);
    expect(wantsVideo("auto", "[::1]")).toBe(false);
    expect(wantsVideo("auto", "ww.localhost")).toBe(false);
    expect(wantsVideo("auto", "watchwright.example.com")).toBe(true);
    expect(wantsVideo("auto", "192.168.1.20")).toBe(true);
    expect(wantsVideo(undefined, "192.168.1.20")).toBe(true);
  });

  it("video and frames say it whatever the address", () => {
    expect(wantsVideo("video", "localhost")).toBe(true);
    expect(wantsVideo("frames", "watchwright.example.com")).toBe(false);
  });
});
