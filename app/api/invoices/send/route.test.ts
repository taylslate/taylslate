import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const {
  getAuthenticatedUser,
  getInvoiceForDelivery,
  getDealById,
  getProfileById,
  getShowProfileByUserId,
  generateInvoicePdf,
  resendSend,
  resolveManagedDelivery,
  getAuthEmail,
  enforceIoSend,
} = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  getInvoiceForDelivery: vi.fn(),
  getDealById: vi.fn(),
  getProfileById: vi.fn(),
  getShowProfileByUserId: vi.fn(),
  generateInvoicePdf: vi.fn(),
  resendSend: vi.fn(),
  resolveManagedDelivery: vi.fn(),
  getAuthEmail: vi.fn(),
  enforceIoSend: vi.fn(),
}));

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: (...a: unknown[]) => getAuthenticatedUser(...a),
  getInvoiceForDelivery: (...a: unknown[]) => getInvoiceForDelivery(...a),
  getDealById: (...a: unknown[]) => getDealById(...a),
  getProfileById: (...a: unknown[]) => getProfileById(...a),
  getShowProfileByUserId: (...a: unknown[]) => getShowProfileByUserId(...a),
}));
vi.mock("@/lib/pdf/invoice-pdf", () => ({
  generateInvoicePdf: (...a: unknown[]) => generateInvoicePdf(...a),
}));
vi.mock("@/lib/email/send", () => ({
  resolveManagedDelivery: (...a: unknown[]) => resolveManagedDelivery(...a),
}));
vi.mock("@/lib/auth/auth-email", () => ({
  getAuthEmail: (...a: unknown[]) => getAuthEmail(...a),
}));
vi.mock("@/lib/security/rate-limit", () => ({
  enforceIoSend: (...a: unknown[]) => enforceIoSend(...a),
}));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: resendSend };
  },
}));

import { POST } from "./route";

const pdf = Buffer.from("pdf-bytes");
const subject = "Invoice INV-1001 for SaunaBox, March 2027";
const ACCOUNT = "brand@accounts.test";
const PLANTED = "planted@evil.test";

const invoice = {
  id: "inv-1",
  invoice_number: "INV-1001",
  io_id: "io-1",
  io_number: "IO-1001",
  bill_to_name: "Jordan Lee",
  bill_to_email: PLANTED,
  from_name: "Host",
  from_email: "host@show.test",
  advertiser_name: "SaunaBox",
  campaign_period: "March 2027",
  line_items: [
    {
      id: "li-1",
      io_line_item_id: "iol-1",
      show_name: "Daily Briefing",
      post_date: "2027-03-12",
      description: "Mid-roll host read",
      guaranteed_downloads: 10000,
      rate: 250,
      make_good: false,
    },
  ],
  subtotal: 250,
  adjustments: 0,
  total_due: 250,
  status: "draft",
  due_date: "2027-04-30",
  created_at: "2027-03-01T00:00:00.000Z",
  updated_at: "2027-03-01T00:00:00.000Z",
};

const deal = {
  id: "deal-1",
  brand_id: "brand-1",
  agent_id: "agent-1",
  agency_id: null as string | null,
  show_profile_id: null as string | null,
};

function post(body: unknown = { invoice_id: "inv-1" }): NextRequest {
  return new NextRequest("http://x/api/invoices/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function passThrough() {
  resolveManagedDelivery.mockImplementation(
    async (input: { to: string; subject: string }) => ({
      ok: true,
      to: input.to,
      subject: input.subject,
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.RESEND_API_KEY = "re_test";
  getAuthenticatedUser.mockResolvedValue({ id: "agent-1", email: "host@show.test" });
  enforceIoSend.mockResolvedValue(null);
  getInvoiceForDelivery.mockResolvedValue({ invoice, dealId: "deal-1" });
  getDealById.mockResolvedValue(deal);
  getProfileById.mockResolvedValue({ full_name: "Host" });
  getShowProfileByUserId.mockResolvedValue(null);
  getAuthEmail.mockImplementation(async (id: string) => (id === "brand-1" ? ACCOUNT : null));
  generateInvoicePdf.mockReturnValue(pdf);
  resendSend.mockResolvedValue({ data: { id: "msg" }, error: null });
  passThrough();
});

describe("POST /api/invoices/send", () => {
  it("sends an unmanaged brand to the account on the deal", async () => {
    const res = await POST(post({ invoice_id: "inv-1", bill_to_email: PLANTED }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).not.toHaveProperty("to");
    expect(body.subject).toBe(subject);
    expect(body.toName).toBe("Jordan Lee");
    expect(JSON.stringify(body)).not.toContain(ACCOUNT);
    expect(JSON.stringify(body)).not.toContain(PLANTED);
    expect(resolveManagedDelivery).toHaveBeenCalledWith({
      to: ACCOUNT,
      subject,
      recipientProfileId: "brand-1",
    });

    const sent = resendSend.mock.calls[0][0];
    expect(sent.from).toBe("Host via Taylslate <invoices@taylslate.com>");
    expect(sent.to).toBe(ACCOUNT);
    expect(sent.subject).toBe(subject);
    expect(sent.html).toContain("Here is the invoice");
    expect(sent.html).not.toMatch(/please find/i);
    expect(sent.html).not.toContain("\u2014");
    expect(sent.attachments).toEqual([
      { filename: "INV-1001.pdf", content: pdf.toString("base64") },
    ]);
    expect(generateInvoicePdf).toHaveBeenCalledWith(
      expect.objectContaining({ bill_to_email: ACCOUNT }),
    );
    expect(JSON.stringify(resendSend.mock.calls)).not.toContain(PLANTED);
  });

  it("uses the deal account and ignores the stored invoice address", async () => {
    getDealById.mockResolvedValue({ ...deal, agency_id: "agency-1" });
    getAuthEmail.mockImplementation(async (id: string) =>
      id === "agency-1" ? "desk@accounts.test" : ACCOUNT,
    );

    const res = await POST(post({ invoice_id: "inv-1", bill_to_email: "request@evil.test" }));
    expect(res.status).toBe(200);
    expect(getAuthEmail).toHaveBeenCalledWith("agency-1");
    expect(getAuthEmail).not.toHaveBeenCalledWith("brand-1");
    expect(resolveManagedDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "desk@accounts.test",
        recipientProfileId: "agency-1",
      }),
    );
    expect(JSON.stringify(resolveManagedDelivery.mock.calls)).not.toContain(PLANTED);
    expect(JSON.stringify(resolveManagedDelivery.mock.calls)).not.toContain("request@evil.test");
  });

  it("reroutes a managed brand to MANAGED_ACCOUNT_INBOX", async () => {
    resolveManagedDelivery.mockResolvedValue({
      ok: true,
      to: "ops@taylslate.com",
      subject: `[managed: ${ACCOUNT}] ${subject}`,
    });

    const res = await POST(post());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).not.toHaveProperty("to");
    expect(body.subject).toBe(subject);
    expect(JSON.stringify(body)).not.toContain(ACCOUNT);
    expect(JSON.stringify(body)).not.toContain("ops@taylslate.com");

    const sent = resendSend.mock.calls[0][0];
    expect(sent.to).toBe("ops@taylslate.com");
    expect(sent.subject).toBe(`[managed: ${ACCOUNT}] ${subject}`);
    expect(sent.from).toBe("Host via Taylslate <invoices@taylslate.com>");
    expect(sent.html).toContain("Here is the invoice");
    expect(sent.attachments).toEqual([
      { filename: "INV-1001.pdf", content: pdf.toString("base64") },
    ]);
    expect(resolveManagedDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ recipientProfileId: "brand-1", to: ACCOUNT }),
    );
  });

  it("returns 409 and does not send when the managed inbox is unset", async () => {
    resolveManagedDelivery.mockResolvedValue({
      ok: false,
      reason: "managed_inbox_unset",
    });
    const res = await POST(post());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/MANAGED_ACCOUNT_INBOX/);
    expect(resendSend).not.toHaveBeenCalled();
  });

  it("returns the same 404 for a missing invoice and a caller who does not own it", async () => {
    getInvoiceForDelivery.mockResolvedValueOnce(null);
    const missing = await POST(post());
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "Invoice not found" });

    getAuthenticatedUser.mockResolvedValue({ id: "brand-1", email: "brand@x.com" });
    const brand = await POST(post());
    expect(brand.status).toBe(404);
    expect(await brand.json()).toEqual({ error: "Invoice not found" });

    getAuthenticatedUser.mockResolvedValue({ id: "stranger", email: "nope@example.test" });
    const stranger = await POST(post());
    expect(stranger.status).toBe(404);
    expect(await stranger.json()).toEqual({ error: "Invoice not found" });
    expect(resendSend).not.toHaveBeenCalled();
    expect(getAuthEmail).not.toHaveBeenCalled();
  });

  it("returns 404 when the deal is missing", async () => {
    getDealById.mockResolvedValueOnce(null);
    const missingDeal = await POST(post());
    expect(missingDeal.status).toBe(404);
    expect(await missingDeal.json()).toEqual({ error: "Invoice not found" });
    expect(resendSend).not.toHaveBeenCalled();
  });

  it("lets the show profile owner send when agent_id is empty", async () => {
    getAuthenticatedUser.mockResolvedValue({ id: "show-user", email: "host@show.test" });
    getDealById.mockResolvedValue({
      ...deal,
      agent_id: null,
      show_profile_id: "sp-1",
    });
    getShowProfileByUserId.mockResolvedValue({ id: "sp-1" });

    const res = await POST(post());
    expect(res.status).toBe(200);
    expect(getShowProfileByUserId).toHaveBeenCalledWith("show-user");
    expect(resendSend.mock.calls[0][0].to).toBe(ACCOUNT);
  });

  it("rejects a client invoice object with 400 and does not send", async () => {
    const onlyObject = await POST(post({ invoice: { ...invoice, bill_to_email: PLANTED } }));
    expect(onlyObject.status).toBe(400);
    expect(await onlyObject.json()).toEqual({ error: "Invalid request" });

    const both = await POST(post({ invoice_id: "inv-1", invoice }));
    expect(both.status).toBe(400);
    expect(await both.json()).toEqual({ error: "Invalid request" });

    const missingId = await POST(post({}));
    expect(missingId.status).toBe(400);
    expect(await missingId.json()).toEqual({ error: "invoice_id is required" });

    expect(getAuthenticatedUser).not.toHaveBeenCalled();
    expect(getInvoiceForDelivery).not.toHaveBeenCalled();
    expect(resendSend).not.toHaveBeenCalled();
  });

  it("returns 401 when the caller is signed out", async () => {
    getAuthenticatedUser.mockResolvedValue(null);
    const res = await POST(post());
    expect(res.status).toBe(401);
    expect(resendSend).not.toHaveBeenCalled();
    expect(enforceIoSend).not.toHaveBeenCalled();
  });

  it("returns 409 when the account address is missing or the caller is the recipient", async () => {
    getAuthEmail.mockResolvedValue(null);
    const missing = await POST(post());
    expect(missing.status).toBe(409);
    expect(await missing.json()).toEqual({ error: "No recipient on file for this invoice" });

    getDealById.mockResolvedValue({ ...deal, brand_id: "agent-1", agency_id: null });
    getAuthEmail.mockResolvedValue(ACCOUNT);
    const self = await POST(post());
    expect(self.status).toBe(409);
    expect(await self.json()).toEqual({ error: "No recipient on file for this invoice" });
    expect(resendSend).not.toHaveBeenCalled();
  });

  it("returns 429 when limited and 503 when the limiter fails", async () => {
    enforceIoSend.mockResolvedValueOnce(
      NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429 }),
    );
    const limited = await POST(post());
    expect(limited.status).toBe(429);
    expect(getInvoiceForDelivery).not.toHaveBeenCalled();

    enforceIoSend.mockResolvedValueOnce(NextResponse.json({ error: "unavailable" }, { status: 503 }));
    const down = await POST(post());
    expect(down.status).toBe(503);
    expect(resendSend).not.toHaveBeenCalled();
  });

  it("does not echo a provider or database error", async () => {
    resendSend.mockResolvedValueOnce({ data: null, error: { message: "relation invoices secret", code: "x" } });
    const failed = await POST(post());
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: "Failed to send" });

    getInvoiceForDelivery.mockRejectedValueOnce(new Error("duplicate key value violates"));
    const thrown = await POST(post());
    expect(thrown.status).toBe(500);
    const body = await thrown.json();
    expect(body).toEqual({ error: "Email send failed" });
    expect(JSON.stringify(body)).not.toContain("duplicate");
  });
});
