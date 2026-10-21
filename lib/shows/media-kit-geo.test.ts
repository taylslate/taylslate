import { deflateSync } from "node:zlib";
import { describe, it, expect } from "vitest";
import {
  formatAudienceGeography,
  mergeGeographyIntoDemographics,
  parseMediaKitGeography,
} from "./media-kit-geo";
import { extractKitText } from "./media-kit-text";

describe("parseMediaKitGeography", () => {
  it("reads a labeled breakdown", () => {
    const text = [
      "Audience geography",
      "United States 62%",
      "United Kingdom 11%",
      "Canada 8%",
      "Australia 5%",
      "Other 14%",
    ].join("\n");
    expect(parseMediaKitGeography(text)).toEqual({
      us: 62,
      uk: 11,
      canada: 8,
      australia: 5,
    });
  });

  it("reads percent-first and parenthetical forms", () => {
    expect(parseMediaKitGeography("62% United States, 9% UK, 6% Canada")).toEqual({
      us: 62,
      uk: 9,
      canada: 6,
    });
    expect(parseMediaKitGeography("Top countries: United States (62%), Australia (4%)")).toEqual({
      us: 62,
      australia: 4,
    });
  });

  it("accepts listener-bridge wording and ignores a nearby non-geo percent", () => {
    expect(parseMediaKitGeography("62% of listeners in the US. The host is 35% funnier in the US.")).toEqual({
      us: 62,
    });
  });

  it("does not treat an age cross-tab as the country total", () => {
    expect(parseMediaKitGeography("United States 18-24: 22%\nUS 70%")).toEqual({ us: 70 });
  });

  it("does not invent a split for a region that is not a country", () => {
    expect(parseMediaKitGeography("North America 80%")).toEqual({});
  });

  it("returns nothing for empty or unrelated text", () => {
    expect(parseMediaKitGeography("")).toEqual({});
    expect(parseMediaKitGeography(null)).toEqual({});
    expect(parseMediaKitGeography("Completion rate 74%. Gender 48% male.")).toEqual({});
  });
});

describe("formatAudienceGeography", () => {
  it("formats the shares that were parsed", () => {
    expect(formatAudienceGeography({ us: 68, uk: 8.5, canada: 6 })).toBe(
      "US 68% · UK 8.5% · Canada 6%"
    );
  });

  it("is empty when nothing was parsed", () => {
    expect(formatAudienceGeography({})).toBe("");
    expect(formatAudienceGeography(null)).toBe("");
  });
});

describe("mergeGeographyIntoDemographics", () => {
  it("keeps age and gender while replacing country shares", () => {
    const next = mergeGeographyIntoDemographics(
      { age_25_34: 40, male: 55, us: 90, uk: 4 },
      { us: 60 },
      { replace: true }
    );
    expect(next.age_25_34).toBe(40);
    expect(next.male).toBe(55);
    expect(next.us).toBe(60);
    expect(next.uk).toBeUndefined();
  });

  it("only fills country keys the show does not already have", () => {
    const next = mergeGeographyIntoDemographics(
      { us: 70 },
      { us: 10, canada: 12 },
      { onlyMissing: true }
    );
    expect(next.us).toBe(70);
    expect(next.canada).toBe(12);
  });
});

describe("extractKitText", () => {
  it("returns plain text unchanged", () => {
    expect(extractKitText("United States 62%")).toBe("United States 62%");
  });

  it("reads a literal string out of an uncompressed PDF stream", () => {
    const body = "BT (United States 62%) Tj ET\n";
    const pdf = `%PDF-1.1\n1 0 obj\n<< /Length ${body.length} >>\nstream\n${body}endstream\nendobj\n%%EOF`;
    expect(extractKitText(Buffer.from(pdf))).toContain("United States 62%");
  });

  it("inflates a FlateDecode stream", () => {
    const plain = Buffer.from("BT (Canada 14%) Tj ET");
    const deflated = deflateSync(plain);
    const header = `%PDF-1.4\n1 0 obj\n<< /Filter /FlateDecode /Length ${deflated.length} >>\nstream\n`;
    const pdf = Buffer.concat([
      Buffer.from(header),
      deflated,
      Buffer.from("\nendstream\nendobj\n%%EOF"),
    ]);
    expect(extractKitText(pdf)).toContain("Canada 14%");
  });

  it("returns empty text for a PDF with no strings", () => {
    expect(extractKitText(Buffer.from("%PDF-1.4\n%%EOF"))).toBe("");
  });
});
