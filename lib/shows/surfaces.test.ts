import { describe, expect, it } from "vitest";
import {
  addonSpend,
  buildSurfaceAddonLines,
  chooseSurfaceShowId,
  formatSurfaceSummary,
  groupPublishedSurfaces,
  ioLineSurfaceCaption,
  parseShowSurfaceId,
  sanitizeAddonSurfaceIds,
  sanitizeShowSurfaceDrafts,
  surfaceAddonDecision,
  surfaceSpotFormat,
  type SellableSurface,
} from "./surfaces";

const SURFACE_ID = "11111111-1111-4111-8111-111111111111";

function surface(over: Partial<SellableSurface> = {}): SellableSurface {
  return {
    id: SURFACE_ID,
    show_id: "show-1",
    type: "newsletter",
    audience_size: 8000,
    format: "Dedicated send",
    min_buy: 10000,
    creative_constraints: "No competitor logos in the header",
    lead_time_days: 7,
    posting_owner: "creator",
    price: 500,
    notes: null,
    published: true,
    ...over,
  };
}

describe("sanitizeShowSurfaceDrafts", () => {
  it("keeps a known surface and trims text", () => {
    const [draft] = sanitizeShowSurfaceDrafts([
      {
        type: "tiktok",
        audience_size: 1200.4,
        format: "  15s clip  ",
        min_buy: 250.556,
        creative_constraints: "  host on camera ",
        lead_time_days: 3.2,
        posting_owner: "brand",
        price: 750,
        notes: " pinned ",
        published: true,
      },
    ]);
    expect(draft).toEqual({
      type: "tiktok",
      audience_size: 1200,
      format: "15s clip",
      min_buy: 250.56,
      creative_constraints: "host on camera",
      lead_time_days: 3,
      posting_owner: "brand",
      price: 750,
      notes: "pinned",
      published: true,
    });
  });

  it("drops unknown types and caps the list", () => {
    const rows = [
      { type: "billboard" },
      ...Array.from({ length: 12 }, () => ({ type: "x", price: 10 })),
    ];
    const drafts = sanitizeShowSurfaceDrafts(rows);
    expect(drafts).toHaveLength(8);
    expect(drafts.every((draft) => draft.type === "x")).toBe(true);
  });

  it("defaults posting owner to the creator and publishes unless explicitly off", () => {
    const [listed, hidden] = sanitizeShowSurfaceDrafts([
      { type: "newsletter" },
      { type: "discord", published: false, posting_owner: "nope" },
    ]);
    expect(listed.posting_owner).toBe("creator");
    expect(listed.published).toBe(true);
    expect(hidden.published).toBe(false);
    expect(hidden.posting_owner).toBe("creator");
  });
});

describe("surface add-ons guide and never gate", () => {
  it("stays selectable when the suggested minimum is above the budget", () => {
    const decision = surfaceAddonDecision({ min_buy: 10000, price: 500 });
    expect(decision.selectable).toBe(true);
    expect(decision.note).toContain("Suggested minimum");
    expect(decision.note).toContain("can still be added");
  });

  it("has no note when the creator did not set a minimum", () => {
    expect(surfaceAddonDecision({ min_buy: null, price: 500 }).note).toBeNull();
  });
});

describe("chooseSurfaceShowId", () => {
  it("uses the catalog show when nobody else has listed surfaces on it", () => {
    expect(
      chooseSurfaceShowId({
        catalogShowId: "catalog",
        catalogOwnedByOther: false,
        existingOwnerShowId: "private",
      })
    ).toEqual({ kind: "catalog", showId: "catalog" });
  });

  it("keeps a private owner show when another creator already listed the catalog show", () => {
    expect(
      chooseSurfaceShowId({
        catalogShowId: "catalog",
        catalogOwnedByOther: true,
        existingOwnerShowId: "private",
      })
    ).toEqual({ kind: "existing_owner", showId: "private" });
  });

  it("asks for a new private show when there is no catalog match", () => {
    expect(
      chooseSurfaceShowId({
        catalogShowId: null,
        catalogOwnedByOther: false,
        existingOwnerShowId: null,
      })
    ).toEqual({ kind: "create_owner", showId: null });
  });
});

describe("groupPublishedSurfaces", () => {
  it("attaches a private-show surface onto the catalog show that shares its Podscan id", () => {
    const grouped = groupPublishedSurfaces({
      catalogIds: ["catalog"],
      podscanByCatalogId: new Map([["catalog", "pd_1"]]),
      podscanBySurfaceShowId: new Map([["private", "pd_1"]]),
      direct: [],
      aliased: [surface({ id: SURFACE_ID, show_id: "private" })],
    });
    expect(grouped.catalog).toHaveLength(1);
    expect(grouped.catalog[0].type).toBe("newsletter");
  });

  it("does not publish a hidden surface", () => {
    const grouped = groupPublishedSurfaces({
      catalogIds: ["catalog"],
      podscanByCatalogId: new Map(),
      podscanBySurfaceShowId: new Map(),
      direct: [surface({ published: false })],
      aliased: [],
    });
    expect(grouped.catalog).toBeUndefined();
  });
});

describe("IO add-on lines", () => {
  it("builds one flat line that references the surface and leaves the episode buy alone", () => {
    const { lines, unpriced } = buildSurfaceAddonLines({
      surfaces: [surface()],
      selectedIds: [SURFACE_ID],
      showName: "The Daily Briefing",
      placement: "mid-roll",
      postDate: "2026-05-01",
      format: "podcast",
    });
    expect(unpriced).toEqual([]);
    expect(lines).toHaveLength(1);
    expect(lines[0].show_surface_id).toBe(SURFACE_ID);
    expect(lines[0].price_type).toBe("flat_rate");
    expect(lines[0].gross_rate).toBe(500);
    expect(lines[0].net_due).toBe(500);
    expect(lines[0].spot_format).toContain("Newsletter mention");
    expect(lines[0].spot_format).toContain("creator posts");
    expect(lines[0].spot_format).toContain("7-day lead");
    expect(ioLineSurfaceCaption(lines[0])).toContain("Add-on: Newsletter mention");
  });

  it("names an unpriced selection instead of writing a zero-dollar line", () => {
    const { lines, unpriced } = buildSurfaceAddonLines({
      surfaces: [surface({ price: null })],
      selectedIds: [SURFACE_ID],
      showName: "The Daily Briefing",
      placement: "mid-roll",
      postDate: "2026-05-01",
      format: "podcast",
    });
    expect(lines).toEqual([]);
    expect(unpriced).toEqual(["Newsletter mention"]);
  });

  it("ignores a high minimum and still writes the line", () => {
    const { lines } = buildSurfaceAddonLines({
      surfaces: [surface({ min_buy: 50000, price: 100 })],
      selectedIds: [SURFACE_ID],
      showName: "The Daily Briefing",
      placement: "pre-roll",
      postDate: "2026-05-01",
      format: "youtube",
    });
    expect(lines).toHaveLength(1);
    expect(lines[0].gross_rate).toBe(100);
    expect(lines[0].format).toBe("youtube");
  });

  it("sums only the selected priced add-ons", () => {
    const spend = addonSpend(
      [surface(), surface({ id: "22222222-2222-4222-8222-222222222222", price: null, type: "x" })],
      [SURFACE_ID, "22222222-2222-4222-8222-222222222222"]
    );
    expect(spend).toBe(500);
  });
});

describe("ids and captions", () => {
  it("accepts a uuid and rejects a name", () => {
    expect(parseShowSurfaceId(`  ${SURFACE_ID.toUpperCase()}  `)).toBe(SURFACE_ID);
    expect(parseShowSurfaceId("newsletter")).toBeNull();
    expect(sanitizeAddonSurfaceIds([SURFACE_ID, SURFACE_ID, "nope"])).toEqual([SURFACE_ID]);
  });

  it("does not caption an episode line that merely has a read format", () => {
    expect(ioLineSurfaceCaption({ spot_format: "Host-read" })).toBeNull();
  });

  it("summarizes published surfaces for the profile", () => {
    expect(
      formatSurfaceSummary([
        surface(),
        surface({ type: "x", price: null, published: false }),
      ])
    ).toBe("Newsletter mention ($500)");
  });

  it("keeps the spot format short enough to print", () => {
    const text = surfaceSpotFormat(
      surface({ creative_constraints: "c".repeat(200), format: "Friday send" })
    );
    expect(text.startsWith("Newsletter mention · Friday send · creator posts · 7-day lead")).toBe(
      true
    );
    expect(text.length).toBeLessThan(220);
  });
});
