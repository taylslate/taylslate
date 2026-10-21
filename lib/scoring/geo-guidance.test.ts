import { describe, it, expect } from "vitest";
import { geographyGuidance } from "./geo-guidance";
import type { CampaignPatternRow, ShowDemographics } from "@/lib/data/types";

function pattern(attrs: Record<string, unknown>): Pick<CampaignPatternRow, "product_attributes"> {
  return { product_attributes: attrs };
}

const SHARES: ShowDemographics = { us: 70, uk: 10, canada: 10, australia: 10 };

describe("geographyGuidance", () => {
  it("quotes a breakdown and does not score when the brief has no target market", () => {
    const result = geographyGuidance({ demographics: SHARES }, pattern({}));
    expect(result.score).toBeNull();
    expect(result.line).toBe("Audience geography: US 70%, UK 10%, Canada 10%, Australia 10%.");
  });

  it("scores the share of the reported audience inside the target market", () => {
    const result = geographyGuidance(
      { demographics: SHARES },
      pattern({ target_geography: "United States" })
    );
    expect(result.score).toBe(70);
    expect(result.line).toContain("70% of the reported audience is in the target market (US)");
  });

  it("does not change the score when the target country is not in the breakdown", () => {
    const result = geographyGuidance(
      { demographics: { us: 80 } },
      pattern({ target_geography: "Germany" })
    );
    expect(result.score).toBeNull();
    expect(result.line).toContain("does not change the score");
  });

  it("is silent when the show has no country shares", () => {
    expect(
      geographyGuidance({ demographics: { male: 60 } }, pattern({ target_geography: "US" }))
    ).toEqual({ score: null, line: null });
  });

  it("reads a target list from target_audience.countries", () => {
    const result = geographyGuidance(
      { demographics: SHARES },
      pattern({ target_audience: { countries: ["US", "Canada"] } })
    );
    expect(result.score).toBe(80);
  });
});
