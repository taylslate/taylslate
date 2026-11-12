import { describe, expect, it } from "vitest";
import { isAllowedRedirectUri, narrowScopes, parseScopeList } from "./clients";

describe("redirect URIs", () => {
  it("accepts https, loopback http, and a private scheme", () => {
    expect(isAllowedRedirectUri("https://example.com/callback")).toBe(true);
    expect(isAllowedRedirectUri("https://example.com/callback?x=1")).toBe(true);
    expect(isAllowedRedirectUri("http://localhost:3000/cb")).toBe(true);
    expect(isAllowedRedirectUri("http://127.0.0.1:9/cb")).toBe(true);
    expect(isAllowedRedirectUri("http://[::1]:8080/cb")).toBe(true);
    expect(isAllowedRedirectUri("cursor://anysphere.cursor-mcp/oauth/callback")).toBe(true);
  });

  it("rejects banned schemes, non-loopback http, fragments, and too many characters", () => {
    for (const uri of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html,hi",
      "file:///tmp/x",
      "http://example.com/cb",
      "http://localhost.evil.com/cb",
      "https://example.com/cb#frag",
      "ftp://example.com/cb",
      "ws://example.com/cb",
      "mailto:user@example.com",
      `https://example.com/${"a".repeat(2000)}`,
    ]) {
      expect(isAllowedRedirectUri(uri)).toBe(false);
    }
  });
});

describe("scopes", () => {
  it("defaults to read and rejects an unknown scope", () => {
    expect(parseScopeList(null, true)).toEqual(["read"]);
    expect(parseScopeList("read write:campaigns", true)).toEqual(["read", "write:campaigns"]);
    expect(parseScopeList("read nope", true)).toBeNull();
  });

  it("lets a refresh scope only narrow", () => {
    expect(narrowScopes(["read", "write:campaigns"], null)).toEqual(["read", "write:campaigns"]);
    expect(narrowScopes(["read", "write:campaigns"], "read")).toEqual(["read"]);
    expect(narrowScopes(["read"], "read write:outreach")).toBeNull();
  });
});
