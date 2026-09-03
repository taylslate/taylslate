import { describe, it, expect } from "vitest";
import { resolveBrandName } from "./_shared";
import type { BrandProfile, Campaign } from "@/lib/data/types";

// resolveBrandName reads `brief`, `name`, `brand_name`, and `brand_identity`;
// cast loose fixtures so each test states just the fields that matter.
function makeCampaign(name: string, brief: unknown): Campaign {
  return { name, brief } as unknown as Campaign;
}
function makeProfile(
  brand_identity: string | null,
  brand_name: string | null = null
): BrandProfile {
  return { brand_identity, brand_name } as unknown as BrandProfile;
}

describe("resolveBrandName", () => {
  it("prefers the Wave 14 2A brand-confirmed product name", () => {
    const out = resolveBrandName(
      makeCampaign("Anything — June 2026", {
        version: 2,
        product: { brand_name: "Sauna Box" },
      }),
      makeProfile("A long identity paragraph that should be ignored entirely.")
    );
    expect(out).toBe("Sauna Box");
  });

  it("prefers the durable brand_name over the brand-identity paragraph", () => {
    const paragraph =
      "We are a premium cold-plunge and sauna company helping busy founders " +
      "recover faster between deep-work sessions every single day of the week";
    const out = resolveBrandName(
      makeCampaign("Untitled campaign", { version: 2 }),
      makeProfile(paragraph, "Aurora Sleep")
    );
    // Returns the brand name, never any of the brief/paragraph prose.
    expect(out).toBe("Aurora Sleep");
    expect(out).not.toContain("every single day");
    expect(out).not.toContain("cold-plunge");
  });

  it("ranks the durable brand_name above the campaign-name fallback", () => {
    const out = resolveBrandName(
      makeCampaign("Legacy Parsed Co — June 2026", { version: 2 }),
      makeProfile(null, "Aurora Sleep")
    );
    expect(out).toBe("Aurora Sleep");
  });

  it("ignores a blank brand_name and falls through the chain", () => {
    const out = resolveBrandName(
      makeCampaign("Acme Co — June 2026", { version: 2 }),
      makeProfile(null, "   ")
    );
    expect(out).toBe("Acme Co");
  });

  it("ignores a V2 product whose brand_name is blank, falling through", () => {
    const out = resolveBrandName(
      makeCampaign("Fallback Co — June 2026", {
        version: 2,
        product: { brand_name: "   " },
      }),
      makeProfile(null)
    );
    expect(out).toBe("Fallback Co");
  });

  it("falls back to the campaign name minus the em-dash suffix", () => {
    const out = resolveBrandName(
      makeCampaign("Acme Co — June 2026", { version: 2 }),
      makeProfile(null)
    );
    expect(out).toBe("Acme Co");
  });

  it("keeps a hyphenated brand name in the campaign-name fallback", () => {
    const out = resolveBrandName(
      makeCampaign("Sun-Dried Tomato Co — June 2026", { version: 2 }),
      makeProfile(null)
    );
    expect(out).toBe("Sun-Dried Tomato Co");
  });

  it("falls back to the brand-identity first clause for placeholder names", () => {
    const out = resolveBrandName(
      makeCampaign("Untitled campaign", { version: 2 }),
      makeProfile("Aurora Sleep, the better mattress for tired founders.")
    );
    expect(out).toBe("Aurora Sleep");
  });

  // Regression (Codex review): a bare hyphen must not split a hyphenated name.
  it("does not split a hyphenated brand-identity name on the hyphen", () => {
    const out = resolveBrandName(
      makeCampaign("Campaign", { version: 2 }),
      makeProfile("Sun-Dried Tomato Co, premium olive oils since 2009.")
    );
    expect(out).toBe("Sun-Dried Tomato Co");
  });

  it("splits the brand identity on a spaced dash", () => {
    const out = resolveBrandName(
      makeCampaign("Campaign", { version: 2 }),
      makeProfile("Aurora — better sleep for everyone")
    );
    expect(out).toBe("Aurora");
  });

  it("returns 'Sponsorship' when nothing usable is present", () => {
    const out = resolveBrandName(
      makeCampaign("Campaign", { version: 2 }),
      makeProfile(null)
    );
    expect(out).toBe("Sponsorship");
  });
});
