import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";

const { adminBuilder, supabaseAdmin, storageBuilder } = vi.hoisted(() => {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn(),
    update: vi.fn().mockReturnThis(),
  };
  const storage = {
    upload: vi.fn().mockResolvedValue({ error: null }),
  };
  return {
    adminBuilder: builder,
    storageBuilder: storage,
    supabaseAdmin: {
      from: vi.fn(() => builder),
      storage: { from: vi.fn(() => storage) },
    },
  };
});

const getOutreachById = vi.fn();
const getWave12DealByEnvelopeId = vi.fn();
const updateWave12Deal = vi.fn();
const logEvent = vi.fn().mockResolvedValue(null);
const downloadCompletedDocument = vi.fn();
const downloadCertificate = vi.fn();
const sendEmail = vi.fn().mockResolvedValue({ ok: true });

vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin }));
vi.mock("@/lib/data/queries", () => ({
  getOutreachById: (...a: unknown[]) => getOutreachById(...a),
  getWave12DealByEnvelopeId: (...a: unknown[]) => getWave12DealByEnvelopeId(...a),
  updateWave12Deal: (...a: unknown[]) => updateWave12Deal(...a),
}));
vi.mock("@/lib/data/events", () => ({
  logEvent: (...a: unknown[]) => logEvent(...a),
}));
vi.mock("@/lib/docusign/envelope", () => ({
  downloadCompletedDocument: (...a: unknown[]) => downloadCompletedDocument(...a),
  downloadCertificate: (...a: unknown[]) => downloadCertificate(...a),
  voidEnvelope: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock("@/lib/email/send", () => ({
  sendEmail: (...a: unknown[]) => sendEmail(...a),
}));

import { POST } from "./route";

const SECRET = "test_docusign_webhook_secret";

function signedRequest(body: object): Request {
  const raw = JSON.stringify(body);
  const sig = createHmac("sha256", SECRET).update(raw).digest("base64");
  return new Request("http://x/api/webhooks/docusign", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-DocuSign-Signature-1": sig,
    },
    body: raw,
  });
}

const baseDeal = {
  id: "deal-1",
  outreach_id: "out-1",
  brand_profile_id: "bp1",
  show_profile_id: "sp1",
  status: "planning",
  agreed_cpm: 28,
  agreed_episode_count: 4,
  agreed_placement: "mid-roll",
  agreed_flight_start: "2026-05-01",
  agreed_flight_end: "2026-05-31",
  docusign_envelope_id: "env-1",
  brand_signed_at: null,
  show_signed_at: null,
  created_at: "2026-04-23T00:00:00Z",
  updated_at: "2026-04-23T00:00:00Z",
};

describe("POST /api/webhooks/docusign", () => {
  beforeEach(() => {
    process.env.DOCUSIGN_WEBHOOK_SECRET = SECRET;
    vi.clearAllMocks();
    getWave12DealByEnvelopeId.mockResolvedValue(baseDeal);
    updateWave12Deal.mockImplementation(async (id: string, patch: object) => ({
      ...baseDeal,
      ...patch,
      id,
    }));
    downloadCompletedDocument.mockResolvedValue(Buffer.from("signedpdfbytes"));
    downloadCertificate.mockResolvedValue(Buffer.from("certificatebytes"));
    // Mocks for sub-queries used by the email helpers
    adminBuilder.single.mockResolvedValue({ data: null, error: null });
    getOutreachById.mockResolvedValue({ show_name: "Daily Briefing" });
  });

  it("rejects requests with a bad signature", async () => {
    const req = new Request("http://x/api/webhooks/docusign", {
      method: "POST",
      headers: { "X-DocuSign-Signature-1": "wrong" },
      body: "{}",
    });
    const res = await POST(req as never);
    expect(res.status).toBe(401);
  });

  it("ignores when no matching deal", async () => {
    getWave12DealByEnvelopeId.mockResolvedValueOnce(null);
    const res = await POST(
      signedRequest({
        event: "envelope-completed",
        data: {
          envelopeId: "missing",
          envelopeSummary: { status: "completed", recipients: { signers: [] } },
        },
      }) as never
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ignored).toBe("no_matching_deal");
  });

  it("records brand_signed event", async () => {
    const res = await POST(
      signedRequest({
        event: "recipient-completed",
        data: {
          envelopeId: "env-1",
          envelopeSummary: {
            status: "sent",
            recipients: {
              signers: [
                { recipientId: "1", signedDateTime: "2026-04-23T12:00:00Z" },
              ],
            },
          },
        },
      }) as never
    );
    expect(res.status).toBe(200);
    expect(updateWave12Deal).toHaveBeenCalledWith(
      "deal-1",
      expect.objectContaining({ status: "brand_signed" })
    );
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "io.brand_signed" })
    );
  });

  it("uploads PDFs and fires io.completed on full signature", async () => {
    const res = await POST(
      signedRequest({
        event: "envelope-completed",
        data: {
          envelopeId: "env-1",
          envelopeSummary: {
            status: "completed",
            recipients: {
              signers: [
                { recipientId: "1", signedDateTime: "2026-04-23T12:00:00Z" },
                { recipientId: "2", signedDateTime: "2026-04-24T08:00:00Z" },
              ],
            },
          },
        },
      }) as never
    );
    expect(res.status).toBe(200);
    expect(storageBuilder.upload).toHaveBeenCalledTimes(2);
    const types = logEvent.mock.calls.map((c) => c[0].eventType);
    expect(types).toContain("io.show_signed");
    expect(types).toContain("io.completed");
  });

  it("voids and cancels on declined", async () => {
    const res = await POST(
      signedRequest({
        event: "envelope-declined",
        data: {
          envelopeId: "env-1",
          envelopeSummary: {
            status: "declined",
            voidedReason: "not interested",
            recipients: { signers: [] },
          },
        },
      }) as never
    );
    expect(res.status).toBe(200);
    expect(updateWave12Deal).toHaveBeenCalledWith(
      "deal-1",
      expect.objectContaining({ status: "cancelled", cancellation_reason: "not interested" })
    );
    const types = logEvent.mock.calls.map((c) => c[0].eventType);
    expect(types).toContain("io.declined");
  });

  it("is idempotent — replayed brand_signed is a no-op", async () => {
    getWave12DealByEnvelopeId.mockResolvedValueOnce({
      ...baseDeal,
      brand_signed_at: "2026-04-23T12:00:00Z",
    });
    const res = await POST(
      signedRequest({
        event: "recipient-completed",
        data: {
          envelopeId: "env-1",
          envelopeSummary: {
            status: "sent",
            recipients: {
              signers: [{ recipientId: "1", signedDateTime: "2026-04-23T12:00:00Z" }],
            },
          },
        },
      }) as never
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.idempotent).toBe(true);
    expect(updateWave12Deal).not.toHaveBeenCalled();
  });
});
