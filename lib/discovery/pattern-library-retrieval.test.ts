import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CampaignPatternRow } from "@/lib/data/types";

// Hoisted chain mock. select/eq/order return `this`; limit is the terminal
// awaited call and resolves to { data, error }. Same shape as event-log.test.ts.
const { builder, supabaseAdmin } = vi.hoisted(() => {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn(),
  };
  return {
    builder,
    supabaseAdmin: { from: vi.fn(() => builder) },
  };
});

vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin }));

import { retrieveAnalogCampaigns } from "./pattern-library-retrieval";

// Helper: build a CampaignPatternRow with the fields the helper actually reads.
function row(
  id: string,
  category: string,
  createdAt: string
): CampaignPatternRow {
  return {
    id,
    campaign_id: null,
    customer_id: null,
    created_at: createdAt,
    product_attributes: { category },
    customer_description: null,
    aov_bucket: "high",
    scoring_weights: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  builder.limit.mockResolvedValue({ data: [], error: null });
});

describe("retrieveAnalogCampaigns", () => {
  it("returns [] when the library is empty", async () => {
    builder.limit.mockResolvedValueOnce({ data: [], error: null });
    const result = await retrieveAnalogCampaigns({
      aovBucket: "high",
      category: "wellness",
    });
    expect(result).toEqual([]);
    expect(supabaseAdmin.from).toHaveBeenCalledWith("campaign_patterns");
  });

  it("returns all matching campaigns when 3 prior patterns match", async () => {
    builder.limit.mockResolvedValueOnce({
      data: [
        row("a", "wellness", "2026-05-01"),
        row("b", "wellness recovery", "2026-04-15"),
        row("c", "premium wellness", "2026-04-10"),
      ],
      error: null,
    });
    const result = await retrieveAnalogCampaigns({
      aovBucket: "high",
      category: "wellness",
    });
    expect(result.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("passes the brief AOV bucket to the SQL eq filter", async () => {
    builder.limit.mockResolvedValueOnce({ data: [], error: null });
    await retrieveAnalogCampaigns({
      aovBucket: "mid",
      category: "wellness",
    });
    expect(builder.eq).toHaveBeenCalledWith("aov_bucket", "mid");
  });

  it("matches by case-insensitive bidirectional substring", async () => {
    // brief 'wellness' should match BOTH:
    //   - a prior 'Premium Wellness Recovery' (prior contains brief)
    //   - a prior 'well' (brief contains prior)
    // And should exclude 'finance'.
    builder.limit.mockResolvedValueOnce({
      data: [
        row("a", "Premium Wellness Recovery", "2026-05-01"),
        row("b", "well", "2026-04-15"),
        row("c", "finance", "2026-04-10"),
      ],
      error: null,
    });
    const result = await retrieveAnalogCampaigns({
      aovBucket: "high",
      category: "wellness",
    });
    expect(result.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("caps results at 10 when the library has 15 matching campaigns", async () => {
    const data = Array.from({ length: 15 }, (_, i) =>
      row(`row-${i}`, "wellness", `2026-05-${String(i + 1).padStart(2, "0")}`)
    );
    builder.limit.mockResolvedValueOnce({ data, error: null });
    const result = await retrieveAnalogCampaigns({
      aovBucket: "high",
      category: "wellness",
    });
    expect(result).toHaveLength(10);
  });

  it("returns results in the recency order supabase provided", async () => {
    // Supabase returns by created_at DESC (the order() call). The JS filter
    // preserves that order; the first 10 we keep are the 10 most recent.
    builder.limit.mockResolvedValueOnce({
      data: [
        row("newest", "wellness", "2026-05-10"),
        row("middle", "wellness", "2026-04-15"),
        row("oldest", "wellness", "2026-01-01"),
      ],
      error: null,
    });
    const result = await retrieveAnalogCampaigns({
      aovBucket: "high",
      category: "wellness",
    });
    expect(result.map((r) => r.id)).toEqual(["newest", "middle", "oldest"]);
    expect(builder.order).toHaveBeenCalledWith("created_at", {
      ascending: false,
    });
  });

  it("short-circuits to [] with no SQL call when category is empty", async () => {
    const result = await retrieveAnalogCampaigns({
      aovBucket: "high",
      category: "   ",
    });
    expect(result).toEqual([]);
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });

  it("returns [] when supabase returns an error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    builder.limit.mockResolvedValueOnce({
      data: null,
      error: { message: "boom" },
    });
    const result = await retrieveAnalogCampaigns({
      aovBucket: "high",
      category: "wellness",
    });
    expect(result).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("returns [] when supabase throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    supabaseAdmin.from.mockImplementationOnce(() => {
      throw new Error("network down");
    });
    const result = await retrieveAnalogCampaigns({
      aovBucket: "high",
      category: "wellness",
    });
    expect(result).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
