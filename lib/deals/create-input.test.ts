import { describe, expect, it } from "vitest";
import { parseDealBody, partiesForRole } from "./create-input";
import { dealsFromImportedIO } from "./import-deals";
import type { IOLineItem } from "@/lib/data/types";

const SHOW_ID = "11111111-1111-4111-8111-111111111111";

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    show_id: SHOW_ID,
    num_episodes: 2,
    placement: "mid-roll",
    ad_format: "host_read",
    price_type: "cpm",
    cpm_rate: 25,
    guaranteed_downloads: 10000,
    is_scripted: false,
    is_personal_experience: true,
    reader_type: "host_read",
    content_type: "evergreen",
    pixel_required: false,
    flight_start: "2026-11-01",
    flight_end: "2026-11-15",
    ...overrides,
  };
}

function line(overrides: Partial<IOLineItem> = {}): IOLineItem {
  return {
    id: "line-1",
    format: "podcast",
    post_date: "2026-11-01",
    guaranteed_downloads: 10000,
    show_name: "Oddvice",
    placement: "mid-roll",
    is_scripted: false,
    is_personal_experience: true,
    reader_type: "host_read",
    content_type: "evergreen",
    pixel_required: false,
    gross_rate: 250,
    gross_cpm: 25,
    price_type: "cpm",
    net_due: 250,
    verified: false,
    make_good_triggered: false,
    ...overrides,
  };
}

describe("partiesForRole", () => {
  it("stamps a brand on brand_id", () => {
    expect(partiesForRole("user-1", "brand")).toEqual({ brand_id: "user-1" });
  });

  it("stamps an agent on agent_id and brand_id", () => {
    expect(partiesForRole("user-1", "agent")).toEqual({
      brand_id: "user-1",
      agent_id: "user-1",
    });
  });

  it("stamps an agency on agency_id and brand_id", () => {
    expect(partiesForRole("user-1", "agency")).toEqual({
      brand_id: "user-1",
      agency_id: "user-1",
    });
  });
});

describe("parseDealBody", () => {
  it("prices a CPM deal from downloads", () => {
    const parsed = parseDealBody(validBody());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.deal.net_per_episode).toBe(250);
    expect(parsed.deal.total_net).toBe(500);
    expect(parsed.deal.cpm_rate).toBe(25);
  });

  it("prices a flat-rate deal from the flat amount", () => {
    const parsed = parseDealBody(
      validBody({ price_type: "flat_rate", cpm_rate: undefined, flat_rate: 875, num_episodes: 3 })
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.deal.net_per_episode).toBe(875);
    expect(parsed.deal.total_net).toBe(2625);
    expect(parsed.deal.cpm_rate).toBe(87.5);
  });

  it("returns field errors instead of a deal when the show and dates are missing", () => {
    const parsed = parseDealBody(validBody({ show_id: "", flight_start: "", flight_end: "nope" }));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.fields.show_id).toBeTruthy();
    expect(parsed.fields.flight_start).toBeTruthy();
    expect(parsed.fields.flight_end).toBeTruthy();
  });
});

describe("dealsFromImportedIO", () => {
  it("makes one deal per show name", () => {
    const drafts = dealsFromImportedIO({
      io_number: "IO-2026-0009",
      advertiser_name: "SaunaBox",
      line_items: [
        line({ show_name: "Oddvice", post_date: "2026-11-01" }),
        line({ id: "line-2", show_name: "Oddvice", post_date: "2026-11-08" }),
        line({ id: "line-3", show_name: "Huberman Lab", post_date: "2026-11-03" }),
      ],
    });
    expect(drafts.map((draft) => draft.label)).toEqual(["Oddvice", "Huberman Lab"]);
    expect(drafts[0].body.num_episodes).toBe(2);
    expect(drafts[0].body.flight_start).toBe("2026-11-01");
    expect(drafts[0].body.flight_end).toBe("2026-11-08");
    expect(drafts[0].body.show_name).toBe("Oddvice");
    expect(drafts[1].body.num_episodes).toBe(1);
  });
});
