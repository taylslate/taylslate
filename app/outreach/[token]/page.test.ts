import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { brandNameFromProfile } from "@/lib/brand/display-name";
import type { BrandProfile } from "@/lib/data/types";

const IDENTITY_PARAGRAPH =
  "we are a nutrition company that sells a nutrition supplement powder";

describe("pitch page brand summary", () => {
  it("routes the headline through brandNameFromProfile, not a raw identity split", () => {
    const src = readFileSync(
      fileURLToPath(new URL("./page.tsx", import.meta.url)),
      "utf8"
    );
    expect(src).toContain('from "@/lib/brand/display-name"');
    expect(src).toContain("brandNameFromProfile");
    expect(src).toContain('select("brand_name, brand_identity, brand_website, user_id")');
    expect(src).toContain('"A brand"');
    expect(src).not.toMatch(/brand_identity\?\.split/);
  });

  it("identity paragraph must not appear in the headline", () => {
    const name =
      brandNameFromProfile({
        brand_name: "SaunaBox",
        brand_identity: IDENTITY_PARAGRAPH,
        brand_website: "https://saunabox.com",
      } as BrandProfile) ?? "A brand";
    const headline = `${name} wants to work with Ottoman History Podcast`;
    expect(headline).toBe("SaunaBox wants to work with Ottoman History Podcast");
    expect(headline).not.toContain(IDENTITY_PARAGRAPH);
    expect(headline).not.toContain("nutrition company");
  });

  it("falls back to A brand when no name can be derived, never the identity paragraph", () => {
    const name =
      brandNameFromProfile({
        brand_name: null,
        brand_identity: null,
        brand_website: null,
      } as BrandProfile) ?? "A brand";
    expect(name).toBe("A brand");
    expect(name).not.toContain("nutrition");
  });

  it("never puts a full identity paragraph in the headline when brand_name is missing", () => {
    const name =
      brandNameFromProfile({
        brand_name: null,
        brand_identity: IDENTITY_PARAGRAPH,
      } as BrandProfile) ?? "A brand";
    const headline = `${name} wants to work with Ottoman History Podcast`;
    expect(headline).not.toContain(IDENTITY_PARAGRAPH);
    expect(name.length).toBeLessThanOrEqual(60);
  });
});
