import { beforeEach, describe, expect, it, vi } from "vitest";

const STORED = "seti_stored_for_brand";
const ROW_SECRET = "seti_row_secret_must_not_leak";

const {
  getAuthenticatedUser,
  getBrandProfileByUserId,
  getOutreachById,
  getShowProfileByUserId,
  getWave12DealById,
  getDealSetupSecret,
  listMakeGoodsFailSoft,
  from,
} = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  getBrandProfileByUserId: vi.fn(),
  getOutreachById: vi.fn(),
  getShowProfileByUserId: vi.fn(),
  getWave12DealById: vi.fn(),
  getDealSetupSecret: vi.fn(),
  listMakeGoodsFailSoft: vi.fn(),
  from: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
}));
vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: (...args: unknown[]) => getAuthenticatedUser(...args),
  getBrandProfileByUserId: (...args: unknown[]) => getBrandProfileByUserId(...args),
  getOutreachById: (...args: unknown[]) => getOutreachById(...args),
  getShowProfileByUserId: (...args: unknown[]) => getShowProfileByUserId(...args),
  getWave12DealById: (...args: unknown[]) => getWave12DealById(...args),
}));
vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: { from } }));
vi.mock("@/lib/make-goods/propose", () => ({
  listMakeGoodsFailSoft: (...args: unknown[]) => listMakeGoodsFailSoft(...args),
}));
vi.mock("@/lib/deals/payment-secrets", () => ({
  getDealSetupSecret: (...args: unknown[]) => getDealSetupSecret(...args),
}));
vi.mock("@/components/deals/Wave12DealClient", () => ({
  default: function Wave12DealClient() {
    return null;
  },
}));
vi.mock("./legacy-client", () => ({
  default: function LegacyDealClient() {
    return null;
  },
}));

import DealDetailPage from "./page";

const DEAL = {
  id: "deal_1",
  outreach_id: "out_1",
  brand_profile_id: "bp_1",
  show_profile_id: "sp_1",
  status: "brand_signed",
  agreed_cpm: 25,
  agreed_episode_count: 3,
  agreed_placement: "mid-roll",
  agreed_flight_start: "2026-05-01",
  agreed_flight_end: "2026-05-31",
  promo_code: null,
  setup_intent_client_secret: ROW_SECRET,
};

function tableResult(data: unknown) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    single: vi.fn(async () => ({ data, error: null })),
    maybeSingle: vi.fn(async () => ({ data, error: null })),
  };
  return builder;
}

beforeEach(() => {
  vi.clearAllMocks();
  getAuthenticatedUser.mockResolvedValue({ id: "user_1", email: "a@example.com" });
  getWave12DealById.mockResolvedValue(DEAL);
  getOutreachById.mockResolvedValue({ show_name: "Night Desk" });
  listMakeGoodsFailSoft.mockResolvedValue([]);
  getDealSetupSecret.mockResolvedValue(STORED);
  from.mockImplementation((table: string) => {
    if (table === "brand_profiles") {
      return tableResult({ brand_identity: "Acme", brand_website: "https://acme.example" });
    }
    if (table === "show_profiles") {
      return tableResult({ show_name: "Night Desk", audience_size: 10000 });
    }
    if (table === "profiles") {
      return tableResult({ platform_fee_percentage: 0.1 });
    }
    throw new Error(`unexpected table ${table}`);
  });
});

function propsOf(element: unknown): { deal: { setup_intent_client_secret?: string | null }; viewerRole: string } {
  if (!element || typeof element !== "object" || !("props" in element)) {
    throw new Error("expected a page element");
  }
  return (element as { props: { deal: { setup_intent_client_secret?: string | null }; viewerRole: string } }).props;
}

describe("deal page secret payload", () => {
  it("gives the show viewer a null secret", async () => {
    getBrandProfileByUserId.mockResolvedValue(null);
    getShowProfileByUserId.mockResolvedValue({ id: "sp_1" });

    const props = propsOf(await DealDetailPage({ params: Promise.resolve({ id: "deal_1" }) }));

    expect(props.viewerRole).toBe("show");
    expect(props.deal.setup_intent_client_secret).toBeNull();
    expect(getDealSetupSecret).not.toHaveBeenCalled();
  });

  it("gives the brand viewer the stored secret", async () => {
    getBrandProfileByUserId.mockResolvedValue({ id: "bp_1" });
    getShowProfileByUserId.mockResolvedValue(null);

    const props = propsOf(await DealDetailPage({ params: Promise.resolve({ id: "deal_1" }) }));

    expect(props.viewerRole).toBe("brand");
    expect(props.deal.setup_intent_client_secret).toBe(STORED);
    expect(props.deal.setup_intent_client_secret).not.toBe(ROW_SECRET);
    expect(getDealSetupSecret).toHaveBeenCalledWith("deal_1");
  });
});
