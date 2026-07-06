import { describe, it, expect } from "vitest";
import { buildShowNotesBlurb } from "./show-notes";

const BRAND = "Sauna Box";
const LINK =
  "https://saunabox.com/?utm_source=podcast&utm_medium=podcast&utm_campaign=huberman-lab-d4e5f6a7";
const CODE = "HUBERMAN";

describe("buildShowNotesBlurb", () => {
  it("includes both link and code clauses when all present", () => {
    const blurb = buildShowNotesBlurb({
      brandName: BRAND,
      promoCode: CODE,
      trackingLink: LINK,
    });
    expect(blurb).toBe(`Check out ${BRAND} at ${LINK} — use code ${CODE}.`);
    expect(blurb).toContain(LINK);
    expect(blurb).toContain(CODE);
  });

  it("link, no code → link clause only, no 'code' text", () => {
    const blurb = buildShowNotesBlurb({
      brandName: BRAND,
      promoCode: null,
      trackingLink: LINK,
    });
    expect(blurb).toBe(`Check out ${BRAND} at ${LINK}.`);
    expect(blurb).not.toMatch(/code/i);
  });

  it("no link, code → code clause only, no link", () => {
    const blurb = buildShowNotesBlurb({
      brandName: BRAND,
      promoCode: CODE,
      trackingLink: null,
    });
    expect(blurb).toBe(`Check out ${BRAND} — use code ${CODE}.`);
    expect(blurb).not.toContain("http");
  });

  it("returns null when neither link nor code is present", () => {
    expect(
      buildShowNotesBlurb({ brandName: BRAND, promoCode: null, trackingLink: null })
    ).toBeNull();
    // Undefined inputs behave the same as null.
    expect(buildShowNotesBlurb({ brandName: BRAND })).toBeNull();
  });

  it("treats blank / whitespace inputs as absent", () => {
    // Blank code + blank link → nothing actionable → null.
    expect(
      buildShowNotesBlurb({ brandName: BRAND, promoCode: "   ", trackingLink: "" })
    ).toBeNull();
    // Blank code but real link → link-only blurb (no dangling code clause).
    expect(
      buildShowNotesBlurb({ brandName: BRAND, promoCode: "  ", trackingLink: LINK })
    ).toBe(`Check out ${BRAND} at ${LINK}.`);
    // Blank link but real code → code-only blurb.
    expect(
      buildShowNotesBlurb({ brandName: BRAND, promoCode: CODE, trackingLink: "   " })
    ).toBe(`Check out ${BRAND} — use code ${CODE}.`);
  });

  it("falls back to a neutral lead when the brand name is blank/missing", () => {
    const blank = buildShowNotesBlurb({
      brandName: "   ",
      promoCode: CODE,
      trackingLink: LINK,
    });
    expect(blank).toBe(`Check out our sponsor at ${LINK} — use code ${CODE}.`);
    const missing = buildShowNotesBlurb({ promoCode: CODE, trackingLink: null });
    expect(missing).toBe(`Check out our sponsor — use code ${CODE}.`);
  });

  it("trims surrounding whitespace on the code and link before use", () => {
    const blurb = buildShowNotesBlurb({
      brandName: `  ${BRAND}  `,
      promoCode: `  ${CODE}  `,
      trackingLink: `  ${LINK}  `,
    });
    expect(blurb).toBe(`Check out ${BRAND} at ${LINK} — use code ${CODE}.`);
  });

  it("never emits 'null', 'undefined', or a double space across the matrix", () => {
    const cases: Array<[string | null, string | null, string | null]> = [
      [BRAND, CODE, LINK],
      [BRAND, null, LINK],
      [BRAND, CODE, null],
      [null, CODE, LINK],
      ["", CODE, LINK],
    ];
    for (const [brandName, promoCode, trackingLink] of cases) {
      const blurb = buildShowNotesBlurb({ brandName, promoCode, trackingLink });
      expect(blurb).not.toBeNull();
      expect(blurb).not.toMatch(/\bnull\b/);
      expect(blurb).not.toMatch(/\bundefined\b/);
      expect(blurb).not.toMatch(/ {2,}/);
    }
  });
});
