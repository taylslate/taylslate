import { describe, it, expect } from "vitest";
import { extractItunesId } from "./lookup";

describe("extractItunesId", () => {
  it("extracts the ID from a standard Apple Podcasts URL", () => {
    expect(
      extractItunesId("https://podcasts.apple.com/us/podcast/show-name/id1234567890")
    ).toBe("1234567890");
  });

  it("extracts from a URL with a trailing query string", () => {
    expect(
      extractItunesId("https://podcasts.apple.com/us/podcast/show/id9999999999?i=1001")
    ).toBe("9999999999");
  });

  it("extracts from a URL with a trailing slash", () => {
    expect(extractItunesId("https://podcasts.apple.com/us/podcast/id12345/")).toBe("12345");
  });

  it("returns null for a bare RSS feed URL", () => {
    expect(extractItunesId("https://feeds.megaphone.fm/ABCD1234")).toBeNull();
  });

  it("returns null for a non-URL", () => {
    expect(extractItunesId("not a url")).toBeNull();
  });
});
