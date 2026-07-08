import { describe, it, expect } from "vitest";
import {
  turnstileEnabled,
  withCaptchaToken,
  isCaptchaError,
  CAPTCHA_RETRY_MESSAGE,
} from "./turnstile";

describe("turnstileEnabled", () => {
  it("is true for a non-empty site key", () => {
    expect(turnstileEnabled("0x4AAA...")).toBe(true);
  });

  it("is false for an empty or whitespace-only site key (local dev)", () => {
    expect(turnstileEnabled("")).toBe(false);
    expect(turnstileEnabled("   ")).toBe(false);
  });
});

describe("withCaptchaToken", () => {
  it("adds captchaToken when a token is present", () => {
    const opts = withCaptchaToken({ redirectTo: "/x" }, "tok-123");
    expect(opts).toEqual({ redirectTo: "/x", captchaToken: "tok-123" });
  });

  it("returns options WITHOUT a captchaToken key when the token is absent", () => {
    const base = { redirectTo: "/x" };
    expect(withCaptchaToken(base, undefined)).not.toHaveProperty("captchaToken");
    expect(withCaptchaToken(base, null)).not.toHaveProperty("captchaToken");
    expect(withCaptchaToken(base, "")).not.toHaveProperty("captchaToken");
  });

  it("does not mutate the original options object", () => {
    const base = { data: { full_name: "Jane" } };
    withCaptchaToken(base, "tok");
    expect(base).not.toHaveProperty("captchaToken");
  });
});

describe("isCaptchaError", () => {
  it("matches Supabase captcha failure messages case-insensitively", () => {
    expect(isCaptchaError("captcha verification process failed")).toBe(true);
    expect(isCaptchaError("Captcha protection: request disallowed")).toBe(true);
  });

  it("does not match unrelated errors or empty input", () => {
    expect(isCaptchaError("Invalid login credentials")).toBe(false);
    expect(isCaptchaError(null)).toBe(false);
    expect(isCaptchaError(undefined)).toBe(false);
  });
});

describe("CAPTCHA_RETRY_MESSAGE", () => {
  it("is human-friendly and not a raw error string", () => {
    expect(CAPTCHA_RETRY_MESSAGE).toMatch(/try again/i);
  });
});
