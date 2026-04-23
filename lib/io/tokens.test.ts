import { describe, it, expect, beforeEach } from "vitest";
import {
  signOutreachToken,
  verifyOutreachToken,
  signMagicLinkToken,
  verifyMagicLinkToken,
} from "./tokens";

describe("outreach tokens", () => {
  beforeEach(() => {
    process.env.OUTREACH_TOKEN_SECRET = "test_outreach_secret_at_least_16_chars";
  });

  it("round-trips a payload", () => {
    const token = signOutreachToken("o-123");
    const payload = verifyOutreachToken(token);
    expect(payload?.outreach_id).toBe("o-123");
    expect(payload?.v).toBe(1);
  });

  it("rejects a tampered signature", () => {
    const token = signOutreachToken("o-123");
    const parts = token.split(".");
    parts[2] = parts[2].slice(0, -2) + "XX";
    const tampered = parts.join(".");
    expect(verifyOutreachToken(tampered)).toBeNull();
  });

  it("rejects a tampered payload", () => {
    const token = signOutreachToken("o-original");
    const evilBody = Buffer.from(JSON.stringify({ outreach_id: "o-evil", v: 1, iat: 0 }))
      .toString("base64")
      .replace(/=+$/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
    const parts = token.split(".");
    parts[1] = evilBody;
    expect(verifyOutreachToken(parts.join("."))).toBeNull();
  });

  it("rejects garbage", () => {
    expect(verifyOutreachToken("not.a.token")).toBeNull();
    expect(verifyOutreachToken("only-one-segment")).toBeNull();
  });

  it("rejects when signed with a different secret", () => {
    const token = signOutreachToken("o-123");
    process.env.OUTREACH_TOKEN_SECRET = "different_secret_at_least_16_chars__";
    expect(verifyOutreachToken(token)).toBeNull();
  });
});

describe("magic link tokens", () => {
  beforeEach(() => {
    process.env.MAGIC_LINK_TOKEN_SECRET = "test_magic_secret_at_least_16_chars__";
  });

  it("round-trips email + return_url", () => {
    const token = signMagicLinkToken("show@example.com", "https://app/outreach/abc");
    const payload = verifyMagicLinkToken(token);
    expect(payload?.email).toBe("show@example.com");
    expect(payload?.return_url).toBe("https://app/outreach/abc");
  });

  it("rejects an expired token", () => {
    const token = signMagicLinkToken("show@example.com", "https://app/x", -10);
    expect(verifyMagicLinkToken(token)).toBeNull();
  });

  it("lowercases and trims the email", () => {
    const token = signMagicLinkToken("  Show@Example.COM  ", "https://app/x");
    const payload = verifyMagicLinkToken(token);
    expect(payload?.email).toBe("show@example.com");
  });
});
