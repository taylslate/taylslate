import { describe, it, expect } from "vitest";
import {
  normalizePromoCode,
  derivePromoCode,
  MAX_PROMO_CODE_LENGTH,
} from "./promo-code";

describe("derivePromoCode (show-name default)", () => {
  it("takes the first word and uppercases it", () => {
    expect(derivePromoCode("Huberman Lab")).toBe("HUBERMAN");
  });

  it("strips a leading article", () => {
    expect(derivePromoCode("The Daily")).toBe("DAILY");
  });

  it("passes through a single-word name", () => {
    expect(derivePromoCode("Acquired")).toBe("ACQUIRED");
  });

  it("drops punctuation and keeps the first token", () => {
    expect(derivePromoCode("Pod Save America!")).toBe("POD");
  });

  it("returns null for empty / whitespace / symbols-only input", () => {
    expect(derivePromoCode("")).toBeNull();
    expect(derivePromoCode("   ")).toBeNull();
    expect(derivePromoCode("!!!")).toBeNull();
    expect(derivePromoCode(null)).toBeNull();
    expect(derivePromoCode(undefined)).toBeNull();
  });
});

describe("normalizePromoCode (brand input)", () => {
  it("keeps alphanumerics, uppercases, trims", () => {
    expect(normalizePromoCode("  saunabox25  ")).toBe("SAUNABOX25");
  });

  it("applies the same first-token rule to typed input", () => {
    expect(normalizePromoCode("save 20% now")).toBe("SAVE");
    expect(normalizePromoCode("the row")).toBe("ROW");
  });

  it("keeps embedded digits within a single token", () => {
    expect(normalizePromoCode("SAVE20")).toBe("SAVE20");
  });

  it("caps at MAX_PROMO_CODE_LENGTH", () => {
    const long = "A".repeat(40);
    expect(normalizePromoCode(long)).toBe("A".repeat(MAX_PROMO_CODE_LENGTH));
  });

  it("treats empty / blank / null as an explicit clear (null)", () => {
    expect(normalizePromoCode("")).toBeNull();
    expect(normalizePromoCode("   ")).toBeNull();
    expect(normalizePromoCode(null)).toBeNull();
    expect(normalizePromoCode(undefined)).toBeNull();
  });

  it("is idempotent — re-normalizing a normalized code is a no-op", () => {
    const once = normalizePromoCode("Huberman Lab");
    expect(normalizePromoCode(once)).toBe(once);
  });
});
