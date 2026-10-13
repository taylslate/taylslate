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
} = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  getDealById: vi.fn(),
  getShowById: vi.fn(),
  getIOByDealId: vi.fn(),
  getProfileById: vi.fn(),
  getNextIONumber: vi.fn(),
  generateIOPdf: vi.fn(),
  recordEvent: vi.fn(),
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
    expect(generateIOPdf).toHaveBeenCalledWith(expect.objectContaining({ deal_id: DEAL_ID, io_number: "IO 1001" }));
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
});
