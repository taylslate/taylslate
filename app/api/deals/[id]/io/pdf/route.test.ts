import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  getAuthenticatedUser,
  getDealById,
  getShowById,
  getIOByDealId,
  getProfileById,
  getNextIONumber,
  generateIOPdf,
  recordEvent,
  isShowsAdmin,
} = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  getDealById: vi.fn(),
  getShowById: vi.fn(),
  getIOByDealId: vi.fn(),
  getProfileById: vi.fn(),
  getNextIONumber: vi.fn(),
  generateIOPdf: vi.fn(),
  recordEvent: vi.fn(),
  isShowsAdmin: vi.fn(),
}));

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: (...a: unknown[]) => getAuthenticatedUser(...a),
  getDealById: (...a: unknown[]) => getDealById(...a),
  getShowById: (...a: unknown[]) => getShowById(...a),
  getIOByDealId: (...a: unknown[]) => getIOByDealId(...a),
  getProfileById: (...a: unknown[]) => getProfileById(...a),
  getNextIONumber: (...a: unknown[]) => getNextIONumber(...a),
}));
vi.mock("@/lib/pdf/io-pdf", () => ({
  generateIOPdf: (...a: unknown[]) => generateIOPdf(...a),
}));
vi.mock("@/lib/data/event-log", () => ({
  recordEvent: (...a: unknown[]) => recordEvent(...a),
}));
vi.mock("@/lib/shows/can-edit-show", () => ({
  isShowsAdmin: (...a: unknown[]) => isShowsAdmin(...a),
}));

import { GET, POST } from "./route";

const DEAL_ID = "deal-1";
const params = Promise.resolve({ id: DEAL_ID });

const deal = {
  id: DEAL_ID,
  show_id: "show-1",
  brand_id: "brand-1",
  agent_id: "agent-1",
  agency_id: "agency-1",
};

const pdfBytes = Buffer.from("%PDF-1.4 test");

function ioBody(dealId: string = DEAL_ID) {
  return {
    io: {
      id: "io-1",
      io_number: "IO 1001",
      deal_id: dealId,
      advertiser_name: "SaunaBox",
      publisher_name: "Show",
      publisher_contact_name: "Host",
      publisher_contact_email: "host@show.test",
      line_items: [],
      total_downloads: 0,
      total_gross: 0,
      total_net: 0,
      payment_terms: "Net 30 EOM",
      competitor_exclusion: [],
      exclusivity_days: 90,
      rofr_days: 30,
      cancellation_notice_days: 14,
      download_tracking_days: 45,
      make_good_threshold: 0.1,
      status: "draft",
      created_at: "2026-10-13T00:00:00.000Z",
      updated_at: "2026-10-13T00:00:00.000Z",
    },
  };
}

function postReq(body: object = ioBody()): Request {
  return new Request(`http://x/api/deals/${DEAL_ID}/io/pdf`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function getReq(): Request {
  return new Request(`http://x/api/deals/${DEAL_ID}/io/pdf`, { method: "GET" });
}

function expectNoIoEvent() {
  expect(recordEvent).not.toHaveBeenCalled();
  expect(generateIOPdf).not.toHaveBeenCalled();
}

async function expectPdf(res: Response, mode: "GET" | "POST", userId: string) {
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("application/pdf");
  const bytes = Buffer.from(await res.arrayBuffer());
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  expect(recordEvent).toHaveBeenCalledWith({
    customerId: userId,
    operationType: "io_generated",
    metadata: { deal_id: DEAL_ID, mode },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  generateIOPdf.mockReturnValue(pdfBytes);
  recordEvent.mockResolvedValue(undefined);
  isShowsAdmin.mockResolvedValue(false);
  getShowById.mockResolvedValue({ id: "show-1", name: "Show", platform: "podcast", episode_cadence: "weekly" });
  getIOByDealId.mockResolvedValue(ioBody().io);
  getProfileById.mockResolvedValue({ company_name: "SaunaBox", full_name: "Brand", email: "brand@x.test" });
});

describe("POST /api/deals/[id]/io/pdf", () => {
  it("rejects anonymous callers before generating a PDF", async () => {
    getAuthenticatedUser.mockResolvedValueOnce(null);
    const res = await POST(postReq() as never, { params });
    expect(res.status).toBe(401);
    expectNoIoEvent();
    expect(getDealById).not.toHaveBeenCalled();
  });

  it("returns 404 when the deal does not exist", async () => {
    getAuthenticatedUser.mockResolvedValueOnce({ id: "brand-1" });
    getDealById.mockResolvedValueOnce(null);
    const res = await POST(postReq() as never, { params });
    expect(res.status).toBe(404);
    expectNoIoEvent();
  });

  it("forbids a signed-in user who is not on the deal", async () => {
    getAuthenticatedUser.mockResolvedValueOnce({ id: "outsider" });
    getDealById.mockResolvedValueOnce(deal);
    const res = await POST(postReq() as never, { params });
    expect(res.status).toBe(403);
    expectNoIoEvent();
  });

  it("rejects a body whose io.deal_id does not match the route", async () => {
    getAuthenticatedUser.mockResolvedValueOnce({ id: "brand-1" });
    getDealById.mockResolvedValueOnce(deal);
    const res = await POST(postReq(ioBody("other-deal")) as never, { params });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/deal_id/);
    expectNoIoEvent();
  });

  it.each([
    ["brand", "brand-1"],
    ["agent", "agent-1"],
    ["agency", "agency-1"],
  ])("returns a PDF for the %s on the deal", async (_role, userId) => {
    getAuthenticatedUser.mockResolvedValueOnce({ id: userId });
    getDealById.mockResolvedValueOnce(deal);
    const res = await POST(postReq() as never, { params });
    await expectPdf(res, "POST", userId);
    expect(generateIOPdf).toHaveBeenCalledWith(
      expect.objectContaining({ deal_id: DEAL_ID, io_number: "IO 1001" }),
      {
        showContactVisible: userId === "agent-1",
        brandContactVisible: userId !== "agent-1",
      }
    );
  });
});

describe("GET /api/deals/[id]/io/pdf", () => {
  it("rejects anonymous callers before generating a PDF", async () => {
    getAuthenticatedUser.mockResolvedValueOnce(null);
    const res = await GET(getReq() as never, { params });
    expect(res.status).toBe(401);
    expectNoIoEvent();
    expect(getDealById).not.toHaveBeenCalled();
  });

  it("returns 404 when the deal does not exist", async () => {
    getAuthenticatedUser.mockResolvedValueOnce({ id: "brand-1" });
    getDealById.mockResolvedValueOnce(null);
    const res = await GET(getReq() as never, { params });
    expect(res.status).toBe(404);
    expectNoIoEvent();
    expect(getShowById).not.toHaveBeenCalled();
  });

  it("forbids a signed-in user who is not on the deal", async () => {
    getAuthenticatedUser.mockResolvedValueOnce({ id: "outsider" });
    getDealById.mockResolvedValueOnce(deal);
    const res = await GET(getReq() as never, { params });
    expect(res.status).toBe(403);
    expectNoIoEvent();
    expect(getShowById).not.toHaveBeenCalled();
  });

  it.each([
    ["brand", "brand-1"],
    ["agent", "agent-1"],
    ["agency", "agency-1"],
  ])("returns a PDF for the %s on the deal", async (_role, userId) => {
    getAuthenticatedUser.mockResolvedValueOnce({ id: userId });
    getDealById.mockResolvedValueOnce(deal);
    const res = await GET(getReq() as never, { params });
    await expectPdf(res, "GET", userId);
  });

  it("returns a generic 500 and does not echo the error", async () => {
    getAuthenticatedUser.mockResolvedValueOnce({ id: "brand-1" });
    getDealById.mockResolvedValueOnce(deal);
    getShowById.mockRejectedValueOnce(new Error('relation "shows" does not exist'));
    const res = await GET(getReq() as never, { params });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "PDF generation failed" });
  });
});

describe("IO pdf contact text", () => {
  const rich = {
    ...ioBody().io,
    advertiser_contact_email: "brand@example.test",
    publisher_contact_email: "host@example.test",
    agency_name: "Left Field",
    agency_contact_name: "Alex",
    agency_contact_email: "desk@example.test",
    agency_billing_contact: "billing@example.test",
    send_invoices_to: "invoices@example.test",
    line_items: [
      {
        id: "line-1",
        format: "podcast",
        post_date: "2026-05-01",
        guaranteed_downloads: 1000,
        show_name: "Harbor",
        placement: "mid-roll",
        is_scripted: false,
        is_personal_experience: true,
        reader_type: "host_read",
        content_type: "evergreen",
        pixel_required: false,
        gross_rate: 25,
        gross_cpm: 25,
        price_type: "cpm",
        net_due: 25,
        verified: false,
        make_good_triggered: false,
      },
    ],
  };

  beforeEach(async () => {
    const actual = await vi.importActual<typeof import("@/lib/pdf/io-pdf")>("@/lib/pdf/io-pdf");
    generateIOPdf.mockImplementation((row: never, opts: never) => actual.generateIOPdf(row, opts));
    getIOByDealId.mockResolvedValue(rich);
  });

  async function textFor(userId: string, row: Record<string, unknown> = deal) {
    getAuthenticatedUser.mockResolvedValue({ id: userId });
    getDealById.mockResolvedValue(row);
    const res = await GET(getReq() as never, { params });
    expect(res.status).toBe(200);
    return Buffer.from(await res.arrayBuffer()).toString("latin1");
  }

  it("masks the other side for a locked deal and reveals both after signing", async () => {
    const brand = await textFor("brand-1");
    expect(brand).toContain("brand@example.test");
    expect(brand).not.toContain("host@example.test");
    expect(brand).toContain("Sent through Taylslate");

    const agent = await textFor("agent-1");
    expect(agent).toContain("host@example.test");
    expect(agent).not.toContain("brand@example.test");
    expect(agent).not.toContain("desk@example.test");

    const open = {
      ...deal,
      outreach_id: "outreach-1",
      status: "show_signed",
      brand_signed_at: "2026-11-01",
      show_signed_at: "2026-11-02",
    };
    const unlocked = await textFor("brand-1", open);
    expect(unlocked).toContain("brand@example.test");
    expect(unlocked).toContain("host@example.test");

    const cancelled = await textFor("brand-1", { ...open, status: "cancelled" });
    expect(cancelled).toContain("brand@example.test");
    expect(cancelled).not.toContain("host@example.test");
  });

  it("masks the other side's addresses from a POST body", async () => {
    getAuthenticatedUser.mockResolvedValue({ id: "brand-1" });
    getDealById.mockResolvedValue(deal);
    const res = await POST(postReq({ io: { ...rich, deal_id: DEAL_ID } }) as never, { params });
    expect(res.status).toBe(200);
    const text = Buffer.from(await res.arrayBuffer()).toString("latin1");
    expect(text).toContain("brand@example.test");
    expect(text).not.toContain("host@example.test");
    expect(text).toContain("Sent through Taylslate");
  });
});
