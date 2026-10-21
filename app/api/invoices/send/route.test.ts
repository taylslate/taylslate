import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  getAuthenticatedUser,
  getInvoiceById,
  getIOById,
  getDealById,
  getProfileById,
  generateInvoicePdf,
  resendSend,
  resolveManagedDelivery,
} = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  getInvoiceById: vi.fn(),
  getIOById: vi.fn(),
  getDealById: vi.fn(),
  getProfileById: vi.fn(),
  generateInvoicePdf: vi.fn(),
  resendSend: vi.fn(),
  resolveManagedDelivery: vi.fn(),
}));

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: (...a: unknown[]) => getAuthenticatedUser(...a),
  getInvoiceById: (...a: unknown[]) => getInvoiceById(...a),
  getIOById: (...a: unknown[]) => getIOById(...a),
  getDealById: (...a: unknown[]) => getDealById(...a),
  getProfileById: (...a: unknown[]) => getProfileById(...a),
}));
vi.mock("@/lib/pdf/invoice-pdf", () => ({
  generateInvoicePdf: (...a: unknown[]) => generateInvoicePdf(...a),
}));
vi.mock("@/lib/email/send", () => ({
  resolveManagedDelivery: (...a: unknown[]) => resolveManagedDelivery(...a),
}));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: resendSend };
  },
}));

import { POST } from "./route";

const pdf = Buffer.from("pdf-bytes");
const subject = "Invoice INV-1001 for SaunaBox, March 2027";

const invoice = {
  id: "inv-1",
  invoice_number: "INV-1001",
  io_id: "io-1",
  io_number: "IO-1001",
  bill_to_name: "Jordan Lee",
  bill_to_email: "brand@x.com",
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

function post(): NextRequest {
  return new NextRequest("http://x/api/invoices/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ invoice_id: "inv-1" }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.RESEND_API_KEY = "re_test";
  getAuthenticatedUser.mockResolvedValue({ id: "u1", email: "brand@x.com" });
  getInvoiceById.mockResolvedValue(invoice);
  getIOById.mockResolvedValue({
    id: "io-1",
    deal_id: "deal-1",
    advertiser_contact_email: "brand@x.com",
  });
  getDealById.mockResolvedValue({
    id: "deal-1",
    brand_id: "brand-1",
    agent_id: null,
  });
  generateInvoicePdf.mockReturnValue(pdf);
  resendSend.mockResolvedValue({ data: { id: "msg" }, error: null });
});

describe("POST /api/invoices/send", () => {
  it("sends an unmanaged brand to the original address", async () => {
    resolveManagedDelivery.mockImplementation(
      async (input: { to: string; subject: string }) => ({
        ok: true,
        to: input.to,
        subject: input.subject,
      }),
    );

    const res = await POST(post());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.to).toBe("brand@x.com");
    expect(body.subject).toBe(subject);
    expect(resolveManagedDelivery).toHaveBeenCalledWith({
      to: "brand@x.com",
      subject,
      recipientProfileId: "brand-1",
    });

    const sent = resendSend.mock.calls[0][0];
    expect(sent.from).toBe("Host via Taylslate <invoices@taylslate.com>");
    expect(sent.to).toBe("brand@x.com");
    expect(sent.subject).toBe(subject);
    expect(sent.html).toContain("Here is the invoice");
    expect(sent.html).not.toMatch(/please find/i);
    expect(sent.html).not.toContain("\u2014");
    expect(sent.attachments).toEqual([
      { filename: "INV-1001.pdf", content: pdf.toString("base64") },
    ]);
  });

  it("reroutes a managed brand to MANAGED_ACCOUNT_INBOX", async () => {
    resolveManagedDelivery.mockResolvedValue({
      ok: true,
      to: "ops@taylslate.com",
      subject: `[managed: brand@x.com] ${subject}`,
    });

    const res = await POST(post());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.to).toBe("ops@taylslate.com");
    expect(body.subject).toBe(`[managed: brand@x.com] ${subject}`);

    const sent = resendSend.mock.calls[0][0];
    expect(sent.to).toBe("ops@taylslate.com");
    expect(sent.subject).toBe(`[managed: brand@x.com] ${subject}`);
    expect(sent.from).toBe("Host via Taylslate <invoices@taylslate.com>");
    expect(sent.html).toContain("Here is the invoice");
    expect(sent.attachments).toEqual([
      { filename: "INV-1001.pdf", content: pdf.toString("base64") },
    ]);
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
});
