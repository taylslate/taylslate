import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  getAuthenticatedUser,
  getDealById,
  getIOByDealId,
  getNextIONumber,
  persistIoForDeal,
  createClient,
  supabaseAdmin,
} = vi.hoisted(() => {
  const chain = () => {
    const builder: Record<string, unknown> = {};
    const self = () => builder;
    builder.update = vi.fn(self);
    builder.insert = vi.fn(self);
    builder.delete = vi.fn(self);
    builder.select = vi.fn(self);
    builder.eq = vi.fn(self);
    builder.not = vi.fn(self);
    builder.then = (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data: null, error: null }).then(resolve);
    return builder;
  };
  return {
    getAuthenticatedUser: vi.fn(),
    getDealById: vi.fn(),
    getIOByDealId: vi.fn(),
    getNextIONumber: vi.fn(),
    persistIoForDeal: vi.fn(),
    createClient: vi.fn(async () => ({ from: () => chain() })),
    supabaseAdmin: { from: vi.fn(() => chain()) },
  };
});

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: (...a: unknown[]) => getAuthenticatedUser(...a),
  getDealById: (...a: unknown[]) => getDealById(...a),
  getIOByDealId: (...a: unknown[]) => getIOByDealId(...a),
  getNextIONumber: (...a: unknown[]) => getNextIONumber(...a),
}));
vi.mock("@/lib/io/persist-io", () => ({
  persistIoForDeal: (...a: unknown[]) => persistIoForDeal(...a),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient,
}));
vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin }));

import { PATCH, POST } from "./route";

const USER_ID = "user-brand";
const params = { params: Promise.resolve({ id: "deal-1" }) };

function dealOwnedBy(userId: string) {
  return {
    id: "deal-1",
    show_id: "show-1",
    brand_id: userId,
    agent_id: null,
    agency_id: null,
    docusign_envelope_id: null,
  };
}

function jsonReq(method: string, body: object): Request {
  return new Request("http://x/api/deals/deal-1/io", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const lineItem = {
  id: "11111111-1111-4111-8111-111111111111",
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
  net_due: 300,
};

beforeEach(() => {
  vi.clearAllMocks();
  getAuthenticatedUser.mockResolvedValue({ id: USER_ID, email: "brand@taylslate.com" });
  getDealById.mockResolvedValue(dealOwnedBy(USER_ID));
  getIOByDealId.mockResolvedValue({ id: "io-1", io_number: "IO-2026-0004", line_items: [lineItem] });
  getNextIONumber.mockResolvedValue("IO-2026-0008");
  persistIoForDeal.mockResolvedValue({
    ioId: "io-new",
    ioNumber: "IO-2026-0008",
    created: true,
    repaired: false,
    lineItemCount: 1,
  });
});

describe("IO route party check", () => {
  it("PATCH returns 401 when nobody is signed in", async () => {
    getAuthenticatedUser.mockResolvedValue(null);
    const res = await PATCH(jsonReq("PATCH", { payment_terms: "Net 15" }) as never, params as never);
    expect(res.status).toBe(401);
    expect(getDealById).not.toHaveBeenCalled();
  });

  it("PATCH returns 404 when the deal does not exist", async () => {
    getDealById.mockResolvedValue(null);
    const res = await PATCH(jsonReq("PATCH", { payment_terms: "Net 15" }) as never, params as never);
    expect(res.status).toBe(404);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("PATCH returns 403 for a user who is not a party", async () => {
    getDealById.mockResolvedValue(dealOwnedBy("someone-else"));
    const res = await PATCH(jsonReq("PATCH", { line_items: [lineItem] }) as never, params as never);
    expect(res.status).toBe(403);
    expect(createClient).not.toHaveBeenCalled();
    expect(persistIoForDeal).not.toHaveBeenCalled();
  });

  it("PATCH keeps the DocuSign lock for a party", async () => {
    getDealById.mockResolvedValue({ ...dealOwnedBy(USER_ID), docusign_envelope_id: "env-1" });
    const res = await PATCH(jsonReq("PATCH", { payment_terms: "Net 15" }) as never, params as never);
    expect(res.status).toBe(409);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("PATCH updates when the caller is the brand", async () => {
    const res = await PATCH(
      jsonReq("PATCH", { payment_terms: "Net 15", line_items: [{ ...lineItem, net_due: 300 }] }) as never,
      params as never
    );
    expect(res.status).toBe(200);
    expect(createClient).toHaveBeenCalled();
    const body = await res.json();
    expect(body.io.id).toBe("io-1");
  });

  it("POST returns 403 for a non-party and does not persist", async () => {
    getDealById.mockResolvedValue({
      ...dealOwnedBy("someone-else"),
      agent_id: "other-agent",
      agency_id: "other-agency",
    });
    const res = await POST(
      jsonReq("POST", {
        advertiser_name: "SaunaBox",
        publisher_name: "Oddvice",
        line_items: [lineItem],
      }) as never,
      params as never
    );
    expect(res.status).toBe(403);
    expect(persistIoForDeal).not.toHaveBeenCalled();
  });

  it("POST creates a draft IO for a party", async () => {
    getIOByDealId.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: "io-new",
      io_number: "IO-2026-0008",
      line_items: [lineItem],
    });
    const res = await POST(
      jsonReq("POST", {
        advertiser_name: "SaunaBox",
        advertiser_contact_email: "ads@saunabox.com",
        publisher_name: "Oddvice",
        publisher_contact_name: "Host",
        publisher_contact_email: "host@show.test",
        payment_terms: "Net 30 EOM",
        line_items: [lineItem],
      }) as never,
      params as never
    );
    expect(res.status).toBe(201);
    expect(persistIoForDeal).toHaveBeenCalledWith(
      expect.objectContaining({
        dealId: "deal-1",
        actorId: USER_ID,
        source: "io_editor",
        overrides: { status: "draft" },
      })
    );
    const body = await res.json();
    expect(body.io.id).toBe("io-new");
  });

  it("POST returns 401 before looking up the deal", async () => {
    getAuthenticatedUser.mockResolvedValue(null);
    const res = await POST(jsonReq("POST", {}) as never, params as never);
    expect(res.status).toBe(401);
    expect(getDealById).not.toHaveBeenCalled();
  });
});
