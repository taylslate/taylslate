import { describe, it, expect } from "vitest";
import {
  isValidLoginEmail,
  normalizeLoginEmail,
  safeLoginNext,
  LOGIN_NEXT_FALLBACK,
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

describe("safeLoginNext", () => {
  it("keeps a same-origin path and defaults to /dashboard", () => {
    expect(safeLoginNext("/campaigns/abc", ORIGIN)).toBe("/campaigns/abc");
    expect(safeLoginNext(null, ORIGIN)).toBe(LOGIN_NEXT_FALLBACK);
    expect(safeLoginNext("//evil.com", ORIGIN)).toBe(LOGIN_NEXT_FALLBACK);
  });
});
