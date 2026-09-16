import { describe, it, expect, vi, beforeEach } from "vitest";

interface SingleBuilder {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  _setSingle: (data: unknown, error?: unknown) => void;
}

const {
  getAuthenticatedUser,
  getBrandProfileByUserId,
  getShowProfileByUserId,
  getOutreachById,
  getWave12DealById,
  updateWave12Deal,
  generateIoPdfFromDeal,
  persistIoForDeal,
  createEnvelope,
  getBrandSigningUrl,
  getShowSigningUrl,
  verifyEnvelopeTabsPlaced,
  logEvent,
  supabaseAdmin,
} = vi.hoisted(() => {
  const builders: Record<string, SingleBuilder> = {};
  function makeBuilder(): SingleBuilder {
    let single: { data: unknown; error: unknown } = { data: null, error: null };
    const b: SingleBuilder = {
      _setSingle: (data: unknown, error: unknown = null) => {
        single = { data, error };
      },
      select: vi.fn(() => b),
      eq: vi.fn(() => b),
      single: vi.fn(async () => single),
    };
    return b;
  }
  return {
    getAuthenticatedUser: vi.fn(),
    getBrandProfileByUserId: vi.fn(),
    getShowProfileByUserId: vi.fn().mockResolvedValue(null),
    getOutreachById: vi.fn(),
    getWave12DealById: vi.fn(),
    updateWave12Deal: vi.fn().mockResolvedValue(null),
    generateIoPdfFromDeal: vi.fn(),
    persistIoForDeal: vi.fn().mockResolvedValue({
      ioId: "io_1",
      ioNumber: "IO-123",
      created: true,
      repaired: false,
      lineItemCount: 1,
    }),
    createEnvelope: vi.fn(),
    getBrandSigningUrl: vi.fn(),
    getShowSigningUrl: vi.fn(),
    verifyEnvelopeTabsPlaced: vi.fn().mockResolvedValue({ ok: true, missing: [] }),
    logEvent: vi.fn().mockResolvedValue(null),
    supabaseAdmin: {
      from: vi.fn((table: string) => {
        if (!builders[table]) builders[table] = makeBuilder();
        return builders[table];
      }),
      _builders: builders,
    },
  };
});

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: (...a: unknown[]) => getAuthenticatedUser(...a),
  getBrandProfileByUserId: (...a: unknown[]) => getBrandProfileByUserId(...a),
  getShowProfileByUserId: (...a: unknown[]) => getShowProfileByUserId(...a),
  getOutreachById: (...a: unknown[]) => getOutreachById(...a),
  getWave12DealById: (...a: unknown[]) => getWave12DealById(...a),
  updateWave12Deal: (...a: unknown[]) => updateWave12Deal(...a),
}));
vi.mock("@/lib/pdf/io-generator", () => ({
  generateIoPdfFromDeal: (...a: unknown[]) => generateIoPdfFromDeal(...a),
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
vi.mock("@/lib/data/events", () => ({ logEvent: (...a: unknown[]) => logEvent(...a) }));
vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin }));
// Neutralize Next's post-response after() so the tab-placement backstop never
// runs (and never warns about being outside a request scope) during the test.
vi.mock("next/server", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, after: vi.fn() };
});

import { POST } from "./route";

const params = Promise.resolve({ id: "deal_1" });
function req(): Request {
  return new Request("https://www.taylslate.com/api/deals/deal_1/send-to-docusign", {
    method: "POST",
  });
}

function planningDeal(overrides: Record<string, unknown> = {}) {
  return {
    id: "deal_1",
    outreach_id: "out_1",
    brand_profile_id: "bp_1",
    show_profile_id: "sp_1",
    status: "planning",
    docusign_envelope_id: null,
    ...overrides,
  };
}

// Stage the happy-path collaborators shared by the create/resume tests.
function stageHappyPath() {
  getAuthenticatedUser.mockResolvedValue({
    id: "u_brand",
    email: "brand@x.com",
    user_metadata: { full_name: "Brand Owner" },
  });
  getBrandProfileByUserId.mockResolvedValue({ id: "bp_1", brand_identity: "Acme Co." });
  getOutreachById.mockResolvedValue({
    id: "out_1",
    show_name: "The Daily Build",
    sent_to_email: "show@x.com",
  });
  supabaseAdmin.from("show_profiles")._setSingle({
    id: "sp_1",
    user_id: "su_1",
    show_name: "The Daily Build",
  });
  supabaseAdmin.from("profiles")._setSingle({ email: "show@x.com", full_name: "Show Owner" });
  generateIoPdfFromDeal.mockReturnValue({
    pdfBuffer: Buffer.from("pdf"),
    ioNumber: "IO-123",
    totalGross: 1000,
    totalNet: 900,
    totalDownloads: 40_000,
    postDates: ["2026-05-01"],
    lineItems: [{ post_date: "2026-05-01", gross_rate: 1000 }],
  });
  getBrandSigningUrl.mockResolvedValue({ url: "https://demo.docusign.net/signing/xyz" });
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(supabaseAdmin._builders)) delete supabaseAdmin._builders[k];
});

describe("POST /api/deals/[id]/send-to-docusign", () => {
  it("401 when unauthenticated", async () => {
    getAuthenticatedUser.mockResolvedValueOnce(null);
    const res = await POST(req() as never, { params });
    expect(res.status).toBe(401);
    expect(createEnvelope).not.toHaveBeenCalled();
    expect(getBrandSigningUrl).not.toHaveBeenCalled();
  });

  it("403 when the caller does not own the deal's brand profile", async () => {
    getAuthenticatedUser.mockResolvedValueOnce({ id: "u_other", email: "o@x.com" });
    getWave12DealById.mockResolvedValueOnce(planningDeal());
    getBrandProfileByUserId.mockResolvedValueOnce({ id: "bp_other" });
    const res = await POST(req() as never, { params });
    expect(res.status).toBe(403);
    expect(createEnvelope).not.toHaveBeenCalled();
    expect(getBrandSigningUrl).not.toHaveBeenCalled();
  });

  it("409 when the deal is not in planning status", async () => {
    getAuthenticatedUser.mockResolvedValueOnce({ id: "u_brand", email: "brand@x.com" });
    getWave12DealById.mockResolvedValueOnce(planningDeal({ status: "brand_signed" }));
    getBrandProfileByUserId.mockResolvedValueOnce({ id: "bp_1" });
    const res = await POST(req() as never, { params });
    expect(res.status).toBe(409);
    expect(createEnvelope).not.toHaveBeenCalled();
    expect(getBrandSigningUrl).not.toHaveBeenCalled();
  });

  it("CREATE: mints a new envelope, persists it, and returns the signing URL", async () => {
    stageHappyPath();
    getWave12DealById.mockResolvedValueOnce(planningDeal({ docusign_envelope_id: null }));
    createEnvelope.mockResolvedValueOnce({ envelopeId: "env_new" });

    const res = await POST(req() as never, { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ signing_url: "https://demo.docusign.net/signing/xyz", envelope_id: "env_new" });

    expect(createEnvelope).toHaveBeenCalledTimes(1);
    // Persists the new envelope id and keeps the deal in planning until signature.
    expect(updateWave12Deal).toHaveBeenCalledWith("deal_1", {
      docusign_envelope_id: "env_new",
      status: "planning",
    });
    // Signing URL requested for the freshly-created envelope, as the embedded brand signer.
    expect(getBrandSigningUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        envelopeId: "env_new",
        signer: expect.objectContaining({ email: "brand@x.com", clientUserId: "brand" }),
      })
    );
  });

  it("RESUME: reuses the existing envelope — does NOT create or persist a new one", async () => {
    stageHappyPath();
    getWave12DealById.mockResolvedValueOnce(
      planningDeal({ docusign_envelope_id: "env_existing" })
    );

    const res = await POST(req() as never, { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.envelope_id).toBe("env_existing");

    // The whole point of resume: no new envelope, no envelope-id write.
    expect(createEnvelope).not.toHaveBeenCalled();
    expect(updateWave12Deal).not.toHaveBeenCalled();
    // Signing URL is refreshed against the existing envelope.
    expect(getBrandSigningUrl).toHaveBeenCalledWith(
      expect.objectContaining({ envelopeId: "env_existing" })
    );
  });

  // ---- IO persistence (the "no envelope without a DB record" invariant) ----

  it("persists the IO record BEFORE creating the envelope", async () => {
    stageHappyPath();
    getWave12DealById.mockResolvedValueOnce(planningDeal());
    createEnvelope.mockResolvedValueOnce({ envelopeId: "env_new" });

    const res = await POST(req() as never, { params });
    expect(res.status).toBe(200);

    expect(persistIoForDeal).toHaveBeenCalledTimes(1);
    expect(persistIoForDeal).toHaveBeenCalledWith(
      expect.objectContaining({
        dealId: "deal_1",
        source: "send_to_docusign",
        rendered: expect.objectContaining({ ioNumber: "IO-123" }),
        contacts: expect.objectContaining({
          publisherContactName: "Show Owner",
          publisherContactEmail: "show@x.com",
        }),
      })
    );
    // Strict ordering: rows exist before any envelope does.
    expect(persistIoForDeal.mock.invocationCallOrder[0]).toBeLessThan(
      createEnvelope.mock.invocationCallOrder[0]
    );
  });

  it("500 with NO envelope and NO signing URL when IO persistence fails", async () => {
    stageHappyPath();
    getWave12DealById.mockResolvedValueOnce(planningDeal());
    persistIoForDeal.mockRejectedValueOnce(new Error("db down"));

    const res = await POST(req() as never, { params });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain("Couldn't record the insertion order");
    expect(createEnvelope).not.toHaveBeenCalled();
    expect(getBrandSigningUrl).not.toHaveBeenCalled();
  });

  it("RESUME still persists the IO record (heals deals whose envelope predates persistence)", async () => {
    stageHappyPath();
    getWave12DealById.mockResolvedValueOnce(
      planningDeal({ docusign_envelope_id: "env_existing" })
    );

    const res = await POST(req() as never, { params });
    expect(res.status).toBe(200);
    expect(persistIoForDeal).toHaveBeenCalledTimes(1);
    expect(createEnvelope).not.toHaveBeenCalled();
  });

  // ---- Show countersignature (brand_signed → publisher recipient view) ----

  it("SHOW: returns a publisher recipient-view URL on brand_signed, without creating an envelope", async () => {
    getAuthenticatedUser.mockResolvedValueOnce({
      id: "u_show",
      email: "show@x.com",
      user_metadata: { full_name: "Show Owner" },
    });
    getWave12DealById.mockResolvedValueOnce(
      planningDeal({
        status: "brand_signed",
        docusign_envelope_id: "env_existing",
      })
    );
    getShowProfileByUserId.mockResolvedValue({
      id: "sp_1",
      show_name: "The Daily Build",
    });
    getShowSigningUrl.mockResolvedValue({
      url: "https://demo.docusign.net/signing/show",
    });

    const res = await POST(req() as never, { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      signing_url: "https://demo.docusign.net/signing/show",
      envelope_id: "env_existing",
    });

    expect(getShowSigningUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        envelopeId: "env_existing",
        signer: expect.objectContaining({ email: "show@x.com", clientUserId: "show" }),
      })
    );
    expect(createEnvelope).not.toHaveBeenCalled();
    expect(getBrandSigningUrl).not.toHaveBeenCalled();
    expect(updateWave12Deal).not.toHaveBeenCalled();
    expect(persistIoForDeal).not.toHaveBeenCalled();
  });

  it("SHOW: 409 once the deal is already show_signed", async () => {
    getAuthenticatedUser.mockResolvedValueOnce({
      id: "u_show",
      email: "show@x.com",
    });
    getWave12DealById.mockResolvedValueOnce(
      planningDeal({
        status: "show_signed",
        docusign_envelope_id: "env_existing",
      })
    );
    getBrandProfileByUserId.mockResolvedValue(null);
    getShowProfileByUserId.mockResolvedValue({ id: "sp_1" });

    const res = await POST(req() as never, { params });
    expect(res.status).toBe(409);
    expect(getShowSigningUrl).not.toHaveBeenCalled();
    expect(createEnvelope).not.toHaveBeenCalled();
  });

  it("BRAND on brand_signed does not get the show recipient-view URL", async () => {
    getAuthenticatedUser.mockResolvedValueOnce({
      id: "u_brand",
      email: "brand@x.com",
    });
    getWave12DealById.mockResolvedValueOnce(
      planningDeal({
        status: "brand_signed",
        docusign_envelope_id: "env_existing",
      })
    );
    getBrandProfileByUserId.mockResolvedValue({ id: "bp_1" });
    getShowProfileByUserId.mockResolvedValue(null);

    const res = await POST(req() as never, { params });
    expect(res.status).toBe(409);
    expect(getShowSigningUrl).not.toHaveBeenCalled();
    expect(getBrandSigningUrl).not.toHaveBeenCalled();
  });
});
