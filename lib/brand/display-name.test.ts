import { describe, it, expect } from "vitest";
import { brandNameFromProfile } from "./display-name";
import type { BrandProfile } from "@/lib/data/types";

function makeProfile(fields: Partial<BrandProfile>): BrandProfile {
  return fields as BrandProfile;
}

describe("brandNameFromProfile", () => {
  it("prefers the durable brand_name, trimmed", () => {
    const out = brandNameFromProfile(
      makeProfile({
        brand_name: "  Aurora Sleep  ",
        brand_identity: "A paragraph that should be ignored.",
        brand_website: "https://aurora.example",
      })
    );
    expect(out).toBe("Aurora Sleep");
  });

  it("falls back to the first brand-identity clause when brand_name is blank", () => {
    const out = brandNameFromProfile(
      makeProfile({
        brand_name: "   ",
        brand_identity: "Aurora Sleep, the better mattress for tired founders.",
      })
    );
    expect(out).toBe("Aurora Sleep");
  });

  it("never returns a full paragraph from brand_identity (bounds to a name)", () => {
    const paragraph =
      "We are a premium cold-plunge and sauna company helping busy founders " +
      "recover faster every single day of the week";
    const out = brandNameFromProfile(makeProfile({ brand_identity: paragraph }));
    expect(out).not.toBeNull();
    expect(out!.length).toBeLessThanOrEqual(60);
    expect(out).not.toContain("every single day");
    // Cut at a word boundary — the result is a whole-word prefix of the source.
    expect(paragraph.startsWith(out!)).toBe(true);
    expect(paragraph[out!.length]).toBe(" ");
  });

  it("does not split a hyphenated brand-identity name on the hyphen", () => {
    const out = brandNameFromProfile(
      makeProfile({ brand_identity: "Sun-Dried Tomato Co, premium olive oils since 2009." })
    );
    expect(out).toBe("Sun-Dried Tomato Co");
  });

  it("falls back to the website domain when there is no name or identity", () => {
    const out = brandNameFromProfile(
      makeProfile({ brand_website: "https://www.saunabox.com/pricing" })
    );
    expect(out).toBe("saunabox.com");
  });

  it("returns null when nothing usable is present", () => {
    expect(brandNameFromProfile(makeProfile({}))).toBeNull();
    expect(
      brandNameFromProfile(makeProfile({ brand_name: null, brand_identity: null, brand_website: null }))
    ).toBeNull();
  });
});
