import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getAuthenticatedUser,
  getDealById,
  getShowById,
  getIOByDealId,
  generateIOPdf,
  resendSend,
  resolveManagedDelivery,
  updateDeal,
  markInsertionOrderSent,
} = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  getDealById: vi.fn(),
  getShowById: vi.fn(),
  getIOByDealId: vi.fn(),
  generateIOPdf: vi.fn(),
  resendSend: vi.fn(),
  resolveManagedDelivery: vi.fn(),
  updateDeal: vi.fn(),
  markInsertionOrderSent: vi.fn(),
}));

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: (...a: unknown[]) => getAuthenticatedUser(...a),
  getDealById: (...a: unknown[]) => getDealById(...a),
  getShowById: (...a: unknown[]) => getShowById(...a),
  getIOByDealId: (...a: unknown[]) => getIOByDealId(...a),
  getProfileById: vi.fn(),
  getNextIONumber: vi.fn(),
  updateDeal: (...a: unknown[]) => updateDeal(...a),
  markInsertionOrderSent: (...a: unknown[]) => markInsertionOrderSent(...a),
}));
vi.mock("@/lib/pdf/io-pdf", () => ({
  generateIOPdf: (...a: unknown[]) => generateIOPdf(...a),
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

const params = Promise.resolve({ id: "deal-1" });
const pdf = Buffer.from("pdf-bytes");

const io = {
  id: "io-1",
  io_number: "IO-1001",
  deal_id: "deal-1",
  advertiser_name: "SaunaBox",
  advertiser_contact_name: "Brand",
  advertiser_contact_email: "brand@x.com",
  publisher_name: "Show",
  publisher_contact_name: "Host",
  publisher_contact_email: "host@show.test",
  line_items: [
    {
      id: "li-1",
      format: "podcast",
      post_date: "2026-05-01",
      guaranteed_downloads: 10000,
      show_name: "Daily Briefing",
      placement: "mid-roll",
      is_scripted: false,
      is_personal_experience: true,
      reader_type: "host_read",
      content_type: "evergreen",
      pixel_required: false,
      gross_rate: 250,
      gross_cpm: 25,
      price_type: "cpm",
      net_due: 250,
      verified: false,
      make_good_triggered: false,
    },
  ],
  total_downloads: 10000,
  total_gross: 250,
  total_net: 250,
  payment_terms: "Net 30 EOM",
  competitor_exclusion: [] as string[],
  exclusivity_days: 90,
  rofr_days: 30,
  cancellation_notice_days: 14,
  download_tracking_days: 45,
  make_good_threshold: 0.1,
  status: "draft",
  created_at: "2026-05-01T00:00:00.000Z",
  updated_at: "2026-05-01T00:00:00.000Z",
};

function post(): Request {
  return new Request("http://x/api/deals/deal-1/io/send", { method: "POST" });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.RESEND_API_KEY = "re_test";
  getAuthenticatedUser.mockResolvedValue({ id: "u1", email: "brand@x.com" });
  getDealById.mockResolvedValue({
    id: "deal-1",
    show_id: "show-1",
    brand_id: "brand-1",
    status: "planning",
  });
  updateDeal.mockResolvedValue({ id: "deal-1", status: "io_sent" });
  markInsertionOrderSent.mockResolvedValue(true);
  getShowById.mockResolvedValue({ id: "show-1", name: "Daily Briefing" });
  getIOByDealId.mockResolvedValue(io);
  generateIOPdf.mockReturnValue(pdf);
  resendSend.mockResolvedValue({ data: { id: "msg" }, error: null });
});

describe("POST /api/deals/[id]/io/send", () => {
  it("sends an unmanaged brand to the original address with the same payload", async () => {
    resolveManagedDelivery.mockImplementation(
      async (input: { to: string; subject: string }) => ({
        ok: true,
        to: input.to,
        subject: input.subject,
      }),
    );

    const res = await POST(post() as never, { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.to).toBe("brand@x.com");
    expect(body.subject).toBe(
      "Insertion order IO-1001 for SaunaBox and Daily Briefing",
    );
    expect(resolveManagedDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "brand@x.com",
        subject: "Insertion order IO-1001 for SaunaBox and Daily Briefing",
        recipientProfileId: "brand-1",
      }),
    );

    const sent = resendSend.mock.calls[0][0];
    expect(sent.from).toBe("Host via Taylslate <io@taylslate.com>");
    expect(sent.to).toBe("brand@x.com");
    expect(sent.subject).toBe(
      "Insertion order IO-1001 for SaunaBox and Daily Briefing",
    );
    expect(sent.html).toContain("Here is the insertion order");
    expect(sent.html).not.toMatch(/please find/i);
    expect(sent.text).toContain("The PDF is attached");
    expect(sent.text).toContain("https://www.taylslate.com");
    expect(sent.attachments).toEqual([
      { filename: "IO-1001.pdf", content: pdf.toString("base64") },
    ]);
    expect(markInsertionOrderSent).toHaveBeenCalledWith("io-1");
    expect(updateDeal).toHaveBeenCalledWith("deal-1", { status: "io_sent" });
  });

  it("reroutes a managed brand and leaves the html and attachment alone", async () => {
    resolveManagedDelivery.mockResolvedValue({
      ok: true,
      to: "ops@taylslate.com",
      subject:
        "[managed: brand@x.com] Insertion order IO-1001 for SaunaBox and Daily Briefing",
    });

    const res = await POST(post() as never, { params });
    expect(res.status).toBe(200);
    const sent = resendSend.mock.calls[0][0];
    expect(sent.to).toBe("ops@taylslate.com");
    expect(sent.subject).toBe(
      "[managed: brand@x.com] Insertion order IO-1001 for SaunaBox and Daily Briefing",
    );
    expect(sent.from).toBe("Host via Taylslate <io@taylslate.com>");
    expect(sent.html).toContain("Here is the insertion order");
    expect(sent.html).not.toMatch(/please find/i);
    expect(sent.attachments).toEqual([
      { filename: "IO-1001.pdf", content: pdf.toString("base64") },
    ]);
    expect(updateDeal).not.toHaveBeenCalled();
    expect(markInsertionOrderSent).not.toHaveBeenCalled();
  });

  it("returns 409 and does not send when the managed inbox is unset", async () => {
    resolveManagedDelivery.mockResolvedValue({
      ok: false,
      reason: "managed_inbox_unset",
    });
    const res = await POST(post() as never, { params });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/MANAGED_ACCOUNT_INBOX/);
    expect(resendSend).not.toHaveBeenCalled();
    expect(updateDeal).not.toHaveBeenCalled();
    expect(markInsertionOrderSent).not.toHaveBeenCalled();
  });

  it("does not mark io_sent when Resend rejects the message", async () => {
    resolveManagedDelivery.mockImplementation(
      async (input: { to: string; subject: string }) => ({
        ok: true,
        to: input.to,
        subject: input.subject,
      }),
    );
    resendSend.mockResolvedValueOnce({ data: null, error: { message: "blocked" } });

    const res = await POST(post() as never, { params });
    expect(res.status).toBe(500);
    expect(updateDeal).not.toHaveBeenCalled();
    expect(markInsertionOrderSent).not.toHaveBeenCalled();
  });
});
