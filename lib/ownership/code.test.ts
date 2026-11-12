import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  OWNERSHIP_CODE_ALPHABET,
  OWNERSHIP_CODE_TTL_MS,
  codeExpiresAt,
  generateOwnershipCode,
  hashOwnershipCode,
  isOwnershipCode,
  ownershipCodeMatchesHash,
  textContainsHashedCode,
  textHasOwnershipCode,
} from "./code";

const CODE = "TAYLSLATE-AB2C34";

describe("ownership codes", () => {
  it("uses 31 symbols and leaves out 0, O, 1, I, and L", () => {
    expect(OWNERSHIP_CODE_ALPHABET).toHaveLength(31);
    expect(new Set(OWNERSHIP_CODE_ALPHABET).size).toBe(31);
    expect(OWNERSHIP_CODE_ALPHABET).toBe("ABCDEFGHJKMNPQRSTUVWXYZ23456789");
    expect(OWNERSHIP_CODE_ALPHABET).not.toMatch(/[0O1IL]/);
  });

  it("generates TAYLSLATE- plus 6 alphabet characters", () => {
    for (let i = 0; i < 40; i += 1) {
      const code = generateOwnershipCode();
      expect(code).toMatch(/^TAYLSLATE-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
      expect(isOwnershipCode(code)).toBe(true);
    }
  });

  it("stores only the sha256 hex of the uppercase code and compares it in constant time", () => {
    const hash = hashOwnershipCode(CODE.toLowerCase());
    expect(hash).toBe(createHash("sha256").update(CODE).digest("hex"));
    expect(hash).not.toContain(CODE);
    expect(ownershipCodeMatchesHash(`  ${CODE.toLowerCase()}  `, hash)).toBe(true);
    expect(ownershipCodeMatchesHash("TAYLSLATE-AB2C35", hash)).toBe(false);
    expect(ownershipCodeMatchesHash(CODE, "abcd")).toBe(false);
    expect(ownershipCodeMatchesHash(CODE, `${"aa".repeat(32)}`)).toBe(false);
  });

  it("expires after 7 days", () => {
    expect(OWNERSHIP_CODE_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(codeExpiresAt(new Date("2026-01-01T00:00:00.000Z"))).toBe("2026-01-08T00:00:00.000Z");
  });

  it("matches the exact code and ignores a longer token", () => {
    expect(textHasOwnershipCode(`notes ${CODE.toLowerCase()}.`, CODE)).toBe(true);
    expect(textHasOwnershipCode(`TAYLSLATE-AB2C345`, CODE)).toBe(false);
    expect(textHasOwnershipCode("no code", CODE)).toBe(false);
    expect(textContainsHashedCode(`see ${CODE}`, hashOwnershipCode(CODE))).toBe(true);
    expect(textContainsHashedCode("TAYLSLATE-ZZZZZZ", hashOwnershipCode(CODE))).toBe(false);
    expect(textContainsHashedCode("nothing", hashOwnershipCode(CODE))).toBe(false);
  });
});
