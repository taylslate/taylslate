import { describe, it, expect } from "vitest";
import {
  isValidLoginEmail,
  normalizeLoginEmail,
  safeLoginNext,
  loginMagicOtpOptions,
  isLoginMagicSignupLink,
  isLoginMagicUnknownUserError,
  LOGIN_NEXT_FALLBACK,
  LOGIN_MAGIC_SHOULD_CREATE_USER,
} from "./login-magic";

const ORIGIN = "https://www.taylslate.com";

describe("normalizeLoginEmail / isValidLoginEmail", () => {
  it("accepts a valid email shape and lowercases it", () => {
    expect(normalizeLoginEmail("  Jane@Example.com ")).toBe("jane@example.com");
    expect(isValidLoginEmail("jane@example.com")).toBe(true);
  });

  it("rejects empty and whitespace-only input", () => {
    expect(normalizeLoginEmail("")).toBe("");
    expect(normalizeLoginEmail("   ")).toBe("");
    expect(normalizeLoginEmail(null)).toBe("");
    expect(isValidLoginEmail("")).toBe(false);
  });
});

describe("loginMagicOtpOptions", () => {
  it("sets shouldCreateUser: false on the login OTP options", () => {
    expect(LOGIN_MAGIC_SHOULD_CREATE_USER).toBe(false);
    expect(loginMagicOtpOptions("https://www.taylslate.com/callback")).toEqual({
      redirectTo: "https://www.taylslate.com/callback",
      shouldCreateUser: false,
    });
  });
});

describe("isLoginMagicSignupLink / isLoginMagicUnknownUserError", () => {
  it("treats GoTrue's magiclink-to-signup conversion as a created user", () => {
    expect(isLoginMagicSignupLink("signup")).toBe(true);
    expect(isLoginMagicSignupLink("magiclink")).toBe(false);
  });

  it("detects a user-not-found generateLink error", () => {
    expect(
      isLoginMagicUnknownUserError({ message: "User not found" }),
    ).toBe(true);
    expect(
      isLoginMagicUnknownUserError({ message: "Invalid redirect URL" }),
    ).toBe(false);
  });
});

describe("safeLoginNext", () => {
  it("keeps a same-origin path and defaults to /dashboard", () => {
    expect(safeLoginNext("/campaigns/abc", ORIGIN)).toBe("/campaigns/abc");
    expect(safeLoginNext(null, ORIGIN)).toBe(LOGIN_NEXT_FALLBACK);
    expect(safeLoginNext("//evil.com", ORIGIN)).toBe(LOGIN_NEXT_FALLBACK);
  });
});
