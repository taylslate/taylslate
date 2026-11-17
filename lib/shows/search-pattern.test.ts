import { describe, expect, it } from "vitest";
import {
  escapeShowNameTerm,
  showNameContainsPattern,
  showNameExactPattern,
} from "./search-pattern";

describe("show name search patterns", () => {
  it("drops a lone star and wraps a star inside a name", () => {
    expect(showNameContainsPattern("*")).toBe("");
    expect(escapeShowNameTerm("*")).toBe("");
    expect(showNameContainsPattern("a*b")).toBe("%ab%");
  });

  it("escapes percent, underscore, and backslash", () => {
    expect(showNameContainsPattern("50%")).toBe("%50\\%%");
    expect(showNameContainsPattern("a_b")).toBe("%a\\_b%");
    expect(showNameContainsPattern("\\")).toBe("%\\\\%");
  });

  it("undoes one escape pass so an already escaped term is not doubled", () => {
    expect(showNameContainsPattern("50\\%")).toBe(showNameContainsPattern("50%"));
    expect(showNameContainsPattern("50\\%")).toBe("%50\\%%");
    expect(showNameExactPattern("50\\%")).toBe(showNameExactPattern("50%"));
  });

  it("keeps a comma and parentheses literal", () => {
    expect(showNameContainsPattern("Rock, Paper (Live)")).toBe("%Rock, Paper (Live)%");
    expect(showNameExactPattern("Rock, Paper (Live)")).toBe("Rock, Paper (Live)");
  });

  it("caps at 100 characters before escaping", () => {
    const raw = `${"a".repeat(99)}%${"b".repeat(50)}`;
    expect(raw).toHaveLength(150);
    expect(escapeShowNameTerm(raw)).toBe(`${"a".repeat(99)}\\%`);
    expect(showNameContainsPattern(raw)).toBe(`%${"a".repeat(99)}\\%%`);
    expect(showNameContainsPattern(raw)).not.toContain("b");
  });

  it("returns an empty pattern for whitespace", () => {
    expect(showNameContainsPattern("   ")).toBe("");
    expect(showNameExactPattern("   ")).toBe("");
    expect(escapeShowNameTerm("  *  ")).toBe("");
  });

  it("builds an exact pattern with no added wildcards", () => {
    expect(showNameExactPattern("Oddvice")).toBe("Oddvice");
    expect(showNameExactPattern("50%")).toBe("50\\%");
    expect(showNameExactPattern("*")).toBe("");
    expect(showNameContainsPattern("Oddvice")).toBe("%Oddvice%");
  });
});
