import { beforeEach, describe, expect, it, vi } from "vitest";
import { SIGNATURE_ANCHORS } from "@/lib/docusign/anchors";

const {
  getAuthenticatedUser,
  getBrandProfileByUserId,
  getShowProfileByUserId,
  getOutreachById,
  getWave12DealById,
  getIOByDealId,
  updateWave12Deal,
  persistIoForDeal,
  createEnvelope,
  getBrandSigningUrl,
  getShowSigningUrl,
  verifyEnvelopeTabsPlaced,
  logEvent,
  getAuthEmail,
  isBrandProfileManaged,
  supabaseAdmin,
} = vi.hoisted(() => {
  function builder(data: unknown) {
    const b: Record<string, unknown> = {};
    const self = () => b;
    b.select = vi.fn(self);
    b.eq = vi.fn(self);
    b.single = vi.fn(async () => ({ data, error: null }));
    return b;
  }
  return {
    getAuthenticatedUser: vi.fn(),
    getBrandProfileByUserId: vi.fn(),
    getShowProfileByUserId: vi.fn(),
    getOutreachById: vi.fn(),
    getWave12DealById: vi.fn(),
    getIOByDealId: vi.fn(),
    updateWave12Deal: vi.fn(),
    persistIoForDeal: vi.fn(),
    createEnvelope: vi.fn(),
    getBrandSigningUrl: vi.fn(),
    getShowSigningUrl: vi.fn(),
    verifyEnvelopeTabsPlaced: vi.fn(),
    logEvent: vi.fn(),
    getAuthEmail: vi.fn(),
    isBrandProfileManaged: vi.fn(),
    supabaseAdmin: {
      from: vi.fn((table: string) => {
        if (table === "show_profiles") {
          return builder({
            id: "sp-1",
            user_id: "show-1",
            show_name: "Harbor",
            audience_size: 8000,
            episode_cadence: "weekly",
            ad_formats: ["host_read_baked"],
            ad_read_types: ["personal_experience"],
            ad_copy_email: "host@example.test",
            billing_email: "host@example.test",
            platform: "podcast",
          });
        }
        return builder({ full_name: "Harbor Host" });
      }),
    },
  };
});

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: (...a: unknown[]) => getAuthenticatedUser(...a),
  getBrandProfileByUserId: (...a: unknown[]) => getBrandProfileByUserId(...a),
  getShowProfileByUserId: (...a: unknown[]) => getShowProfileByUserId(...a),
  getOutreachById: (...a: unknown[]) => getOutreachById(...a),
  getWave12DealById: (...a: unknown[]) => getWave12DealById(...a),
  getIOByDealId: (...a: unknown[]) => getIOByDealId(...a),
  updateWave12Deal: (...a: unknown[]) => updateWave12Deal(...a),
}));
vi.mock("@/lib/io/persist-io", () => ({
  persistIoForDeal: (...a: unknown[]) => persistIoForDeal(...a),
}));
vi.mock("@/lib/docusign/envelope", () => ({
  createEnvelope: (...a: unknown[]) => createEnvelope(...a),
  getBrandSigningUrl: (...a: unknown[]) => getBrandSigningUrl(...a),
  getShowSigningUrl: (...a: unknown[]) => getShowSigningUrl(...a),
  verifyEnvelopeTabsPlaced: (...a: unknown[]) => verifyEnvelopeTabsPlaced(...a),
}));
vi.mock("@/lib/data/events", () => ({
  logEvent: (...a: unknown[]) => logEvent(...a),
}));
vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin }));
vi.mock("@/lib/auth/auth-email", () => ({
  getAuthEmail: (...a: unknown[]) => getAuthEmail(...a),
}));
vi.mock("@/lib/accounts/managed", () => ({
  isBrandProfileManaged: (...a: unknown[]) => isBrandProfileManaged(...a),
}));
vi.mock("next/server", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, after: vi.fn() };
});

import { POST } from "@/app/api/deals/[id]/send-to-docusign/route";

beforeEach(() => {
  vi.clearAllMocks();
  getAuthenticatedUser.mockResolvedValue({
    id: "brand-1",
    email: "brand@example.test",
    user_metadata: { full_name: "Brand Owner" },
  });
  getBrandProfileByUserId.mockResolvedValue({
    id: "bp-1",
    user_id: "brand-1",
    brand_name: "Northwind",
    brand_website: "https://northwind.example",
  });
  getShowProfileByUserId.mockResolvedValue(null);
  getOutreachById.mockResolvedValue({
    id: "outreach-1",
    show_name: "Harbor",
    sent_to_email: "host@example.test",
  });
  getWave12DealById.mockResolvedValue({
    id: "deal-1",
    outreach_id: "outreach-1",
    brand_profile_id: "bp-1",
    show_profile_id: "sp-1",
    brand_id: "brand-1",
    status: "planning",
    docusign_envelope_id: null,
    agreed_cpm: 25,
    agreed_episode_count: 1,
    agreed_placement: "mid-roll",
    agreed_flight_start: "2026-05-01",
    agreed_flight_end: "2026-05-31",
    created_at: "2026-04-23T00:00:00.000Z",
  });
  getIOByDealId.mockResolvedValue(null);
  getAuthEmail.mockResolvedValue("host@example.test");
  isBrandProfileManaged.mockResolvedValue(false);
  persistIoForDeal.mockResolvedValue({ ioId: "io-1", created: true, lineItemCount: 1 });
  updateWave12Deal.mockResolvedValue({ id: "deal-1" });
  createEnvelope.mockResolvedValue({ envelopeId: "env-1" });
  getBrandSigningUrl.mockResolvedValue({ url: "https://demo.docusign.net/signing/fixture" });
  verifyEnvelopeTabsPlaced.mockResolvedValue({ ok: true, missing: [] });
  logEvent.mockResolvedValue(null);
});

describe("send-to-docusign routing stays on the real addresses", () => {
  it("gives DocuSign the account emails and a PDF with neither address", async () => {
    const res = await POST(
      new Request("https://www.taylslate.com/api/deals/deal-1/send-to-docusign", {
        method: "POST",
      }) as never,
      { params: Promise.resolve({ id: "deal-1" }) }
    );
    expect(res.status).toBe(200);
    expect(createEnvelope).toHaveBeenCalledTimes(1);
    const input = createEnvelope.mock.calls[0][0] as {
      pdfBuffer: Buffer;
      show: { email: string };
      brand: { email: string };
    };
    expect(input.show.email).toBe("host@example.test");
    expect(input.brand.email).toBe("brand@example.test");
    const text = input.pdfBuffer.toString("latin1");
    expect(text).not.toContain("host@example.test");
    expect(text).not.toContain("brand@example.test");
    expect(text).toContain("Sent through Taylslate");
    expect(text).toContain(SIGNATURE_ANCHORS.advertiser);
    expect(text).toContain(SIGNATURE_ANCHORS.publisher);
    expect(text).toContain(SIGNATURE_ANCHORS.advertiserDate);
    expect(text).toContain(SIGNATURE_ANCHORS.publisherDate);
  });
});
