import { describe, it, expect, vi, beforeEach } from "vitest";
import { TEST_ACCOUNTS } from "@/lib/admin/test-accounts";

const BRAND = TEST_ACCOUNTS.find((a) => a.key === "brand1")!;
const SHOW = TEST_ACCOUNTS.find((a) => a.key === "show1")!;

const { adminBuilder, supabaseAdmin } = vi.hoisted(() => {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(),
    single: vi.fn(),
  };
  return { adminBuilder: builder, supabaseAdmin: { from: vi.fn(() => builder) } };
});

const getAuthenticatedUser = vi.fn();
const createShow = vi.fn();
const createOutreach = vi.fn();
const createWave12Deal = vi.fn();
const getWave12DealById = vi.fn();
const isInternalAdmin = vi.fn();
const logEvent = vi.fn().mockResolvedValue(null);

vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin }));
vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: (...a: unknown[]) => getAuthenticatedUser(...a),
  createShow: (...a: unknown[]) => createShow(...a),
  createOutreach: (...a: unknown[]) => createOutreach(...a),
  createWave12Deal: (...a: unknown[]) => createWave12Deal(...a),
  getWave12DealById: (...a: unknown[]) => getWave12DealById(...a),
}));
vi.mock("@/lib/auth/admin", () => ({
  isInternalAdmin: (...a: unknown[]) => isInternalAdmin(...a),
}));
vi.mock("@/lib/data/events", () => ({ logEvent: (...a: unknown[]) => logEvent(...a) }));

import { POST } from "./route";

function req(): Request {
  return new Request("http://x/api/admin/seed-deal", { method: "POST" });
}

// Queue one seed call's worth of service-role responses:
//   brand_profiles.maybeSingle -> show_profiles.maybeSingle -> campaigns.single
function primeServiceRole(brandWebsite: string | null = "https://morelessprotein.com/") {
  adminBuilder.maybeSingle
    .mockResolvedValueOnce({ data: { id: "bp1", brand_website: brandWebsite }, error: null })
    .mockResolvedValueOnce({ data: { id: "sp1" }, error: null });
  adminBuilder.single.mockResolvedValueOnce({ data: { id: "camp-1" }, error: null });
}

beforeEach(() => {
  vi.clearAllMocks();
  getAuthenticatedUser.mockResolvedValue({ id: "u-admin", email: "chris@taylslate.com" });
  isInternalAdmin.mockReturnValue(true);
  createShow.mockResolvedValue({ id: "show-1", name: "[SEED] The Test Feed" });
  createOutreach.mockResolvedValue({ id: "outreach-1", name: "[SEED] out" });
  createWave12Deal.mockResolvedValue({
    id: "deal-1",
    status: "planning",
    agreed_cpm: 25,
    brand_profile_id: "bp1",
    show_profile_id: "sp1",
    outreach_id: "outreach-1",
  });
  getWave12DealById.mockResolvedValue({ id: "deal-1", agreed_cpm: 25, status: "planning" });
  primeServiceRole();
});

describe("POST /api/admin/seed-deal", () => {
  it("rejects unauthenticated (401)", async () => {
    getAuthenticatedUser.mockResolvedValueOnce(null);
    const res = await POST(req() as never);
    expect(res.status).toBe(401);
    expect(createShow).not.toHaveBeenCalled();
  });

  it("rejects a non-admin caller (403)", async () => {
    isInternalAdmin.mockReturnValueOnce(false);
    const res = await POST(req() as never);
    expect(res.status).toBe(403);
    expect(createShow).not.toHaveBeenCalled();
  });

  it("fabricates the full chain with correct FKs", async () => {
    const res = await POST(req() as never);
    expect(res.status).toBe(200);

    // Campaign inserted via service role, owned by the test brand.
    expect(adminBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: BRAND.userId,
        name: expect.stringContaining("[SEED]"),
      })
    );
    // Outreach wired to the seeded brand_profile / campaign / show.
    expect(createOutreach).toHaveBeenCalledWith(
      expect.objectContaining({
        brand_profile_id: "bp1",
        campaign_id: "camp-1",
        show_id: "show-1",
        sent_to_email: SHOW.email,
        response_status: "accepted",
      })
    );
  });

  it("sets all five ownership columns on the deal insert", async () => {
    await POST(req() as never);
    expect(createWave12Deal).toHaveBeenCalledWith(
      expect.objectContaining({
        outreach_id: "outreach-1",
        brand_profile_id: "bp1",
        show_profile_id: "sp1",
        brand_id: BRAND.userId,
        show_id: "show-1",
      })
    );
  });

  it("creates the deal through the planning-only createWave12Deal path with non-null agreed_cpm", async () => {
    const res = await POST(req() as never);
    expect(res.status).toBe(200);
    expect(createWave12Deal).toHaveBeenCalledWith(
      expect.objectContaining({ agreed_cpm: 25 })
    );
    // status "planning" is an invariant enforced inside createWave12Deal.
    expect(createWave12Deal).toHaveBeenCalledTimes(1);
  });

  it("fails loudly (500) if the created deal has a null agreed_cpm", async () => {
    getWave12DealById.mockResolvedValueOnce({ id: "deal-1", agreed_cpm: null });
    const res = await POST(req() as never);
    expect(res.status).toBe(500);
    // The guard runs after the deal insert but before the marker event.
    expect(logEvent).not.toHaveBeenCalled();
  });

  it("fires the deal.seeded marker event with all seeded entity ids", async () => {
    const res = await POST(req() as never);
    expect(res.status).toBe(200);
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "deal.seeded",
        entityType: "deal",
        entityId: "deal-1",
        actorId: "u-admin",
        payload: expect.objectContaining({
          seeded: true,
          showId: "show-1",
          campaignId: "camp-1",
          outreachId: "outreach-1",
          dealId: "deal-1",
        }),
      })
    );
  });

  it("returns dealUrl + seededEntityIds and no warning when brand_website is set", async () => {
    const res = await POST(req() as never);
    const body = await res.json();
    expect(body.dealId).toBe("deal-1");
    expect(body.dealUrl).toBe("http://x/deals/deal-1");
    expect(body.seededEntityIds).toEqual({
      show: "show-1",
      campaign: "camp-1",
      outreach: "outreach-1",
      deal: "deal-1",
    });
    expect(body.warnings).toEqual([]);
  });

  it("surfaces a warning when the test brand's brand_website is blank", async () => {
    adminBuilder.maybeSingle.mockReset();
    primeServiceRole(null);
    const res = await POST(req() as never);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.warnings).toHaveLength(1);
    expect(body.warnings[0]).toContain("brand_website");
  });

  it("second call creates a fully independent seed (distinct outreach token + show name)", async () => {
    await POST(req() as never);
    // Queue a second call's worth of service-role responses.
    primeServiceRole();
    await POST(req() as never);

    expect(createShow).toHaveBeenCalledTimes(2);
    expect(createOutreach).toHaveBeenCalledTimes(2);
    expect(createWave12Deal).toHaveBeenCalledTimes(2);

    const token1 = createOutreach.mock.calls[0][0].token;
    const token2 = createOutreach.mock.calls[1][0].token;
    expect(token1).not.toEqual(token2);

    const name1 = createShow.mock.calls[0][0].name;
    const name2 = createShow.mock.calls[1][0].name;
    expect(name1).not.toEqual(name2);
  });
});
