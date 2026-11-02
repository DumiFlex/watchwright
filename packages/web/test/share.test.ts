import { describe, expect, it } from "vitest";
import { shareUrl } from "../src/share";

describe("shareUrl", () => {
  it("puts the link's page after the server's address", () => {
    expect(shareUrl("#/s/AbCdEfGhIjKlMnOpQr_-12", "https://ww.example.com")).toBe("https://ww.example.com/#/s/AbCdEfGhIjKlMnOpQr_-12");
    expect(shareUrl("#/s/x", "http://127.0.0.1:7420/")).toBe("http://127.0.0.1:7420/#/s/x");
  });
});
