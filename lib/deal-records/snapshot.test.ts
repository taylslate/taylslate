import { describe, expect, it } from "vitest";
import { buildDealPriceSnapshot } from "./snapshot";

describe("buildDealPriceSnapshot", () => {
  it("maps a flat read and keeps placement text", () => {
    const snapshot = buildDealPriceSnapshot({
      deal: {
        id: "flat-deal",
        show_id: "show-1",
        brand_id: "brand-1",
        brand_profile_id: "bp-1",
        price_type: "flat_rate",
        agreed_flight_start: "2026-08-01",
        agreed_flight_end: "2026-08-31",
        show_signed_at: "2026-07-01T00:00:00.000Z",
      },
      orders: [
        {
          id: "io-1",
          io_number: "IO-FLAT-DE",
          total_gross: 4000,
          total_net: 4000,
          payment_terms: "Off platform",
          payment_off_platform: true,
          created_at: "2026-07-01T00:00:00.000Z",
        },
      ],
      lines: [
        {
          io_id: "io-1",
          format: "youtube",
          placement: "integrated mention",
          price_type: "flat_rate",
          gross_rate: 2000,
          gross_cpm: 0,
          spot_format: "integrated read",
          guaranteed_downloads: 0,
        },
        {
          io_id: "io-1",
          format: "youtube",
          placement: "integrated mention",
          price_type: "flat_rate",
          gross_rate: 2000,
          gross_cpm: 0,
          guaranteed_downloads: 0,
        },
      ],
      showPlatform: "youtube",
      now: "2026-07-02T00:00:00.000Z",
    });
    expect(snapshot.pricing_basis).toBe("flat");
    expect(snapshot.unit_rate).toBe(2000);
    expect(snapshot.medium).toBe("youtube");
    expect(snapshot.placement).toBe("integrated mention");
    expect(snapshot.unit_format).toBe("integrated read");
    expect(snapshot.agreed_total_gross).toBe(4000);
    expect(snapshot.terms.payment_off_platform).toBe(true);
    expect(snapshot.booked_at).toBe("2026-07-01T00:00:00.000Z");
  });
});
