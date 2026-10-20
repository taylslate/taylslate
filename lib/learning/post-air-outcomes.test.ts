import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: { from: vi.fn() } }));

import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  loadCampaignBrandUserId,
  loadPostAirConversionsByShow,
} from "./post-air-outcomes";

describe("loadPostAirConversionsByShow", () => {
  beforeEach(() => {
    vi.mocked(supabaseAdmin.from).mockReset();
  });

  it("returns an empty map and does not query when the brand id is blank", async () => {
    const totals = await loadPostAirConversionsByShow(["show-1"], "  ");
    expect(totals.size).toBe(0);
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });

  it("reads campaigns.user_id for the campaign being viewed", async () => {
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () =>
          table === "campaigns"
            ? { data: { user_id: "brand-a" }, error: null }
            : { data: null, error: { message: "no" } },
      };
      return builder as never;
    });
    await expect(loadCampaignBrandUserId("camp-1")).resolves.toBe("brand-a");
    await expect(loadCampaignBrandUserId("  ")).resolves.toBeNull();
  });
});
