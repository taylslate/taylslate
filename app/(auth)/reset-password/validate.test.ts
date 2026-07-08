import { describe, it, expect } from "vitest";
import { validateNewPassword } from "./validate";

describe("validateNewPassword", () => {
  it("accepts a matching password of at least 8 chars", () => {
    expect(validateNewPassword("password1234", "password1234")).toBeNull();
  });

  it("rejects a password shorter than 8 chars", () => {
    expect(validateNewPassword("short", "short")).toMatch(/at least 8 characters/i);
  });

  it("rejects mismatched passwords", () => {
    expect(validateNewPassword("password1234", "password9999")).toMatch(
      /do not match/i
    );
  });

  it("checks length before match (short + mismatched → length error)", () => {
    expect(validateNewPassword("abc", "xyz")).toMatch(/at least 8 characters/i);
  });
});
