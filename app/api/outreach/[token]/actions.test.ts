import { describe, it, expect, vi, beforeEach } from "vitest";

const verifyOutreachToken = vi.fn();
const getOutreachById = vi.fn();
const getCampaignById = vi.fn();
const updateOutreachResponse = vi.fn();
const isOutreachOpen = vi.fn();

const { adminBuilder, supabaseAdmin } = vi.hoisted(() => {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    single: vi.fn(),
    maybeSingle: vi.fn(),
  };
  return {
    adminBuilder: builder,
    supabaseAdmin: {
      from: vi.fn(() => builder),
      rpc: async () => ({ data: [], error: null }),
      auth: {
        admin: {
          getUserById: vi.fn(async () => ({ data: { user: null }, error: { message: "missing" } })),
        },
      },
    },
  };
});

const sendEmail = vi.fn().mockResolvedValue({ ok: true });
const checkRateLimit = vi.fn();
const createWave12Deal = vi.fn();
const getWave12DealByOutreachId = vi.fn();
const resolveOrMaterializeShowIdForOutreach = vi.fn();
const logEvent = vi.fn().mockResolvedValue(null);

vi.mock("@/lib/io/tokens", () => ({
  verifyOutreachToken: (...args: unknown[]) => verifyOutreachToken(...args),
}));
vi.mock("@/lib/data/queries", () => ({
  getOutreachById: (...args: unknown[]) => getOutreachById(...args),
  getCampaignById: (...args: unknown[]) => getCampaignById(...args),
  updateOutreachResponse: (...args: unknown[]) => updateOutreachResponse(...args),
  isOutreachOpen: (...args: unknown[]) => isOutreachOpen(...args),
  createWave12Deal: (...args: unknown[]) => createWave12Deal(...args),
  getWave12DealByOutreachId: (...args: unknown[]) => getWave12DealByOutreachId(...args),
  resolveOrMaterializeShowIdForOutreach: (...args: unknown[]) =>
    resolveOrMaterializeShowIdForOutreach(...args),
}));
vi.mock("@/lib/data/events", () => ({ logEvent: (...a: unknown[]) => logEvent(...a) }));
vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin }));
vi.mock("@/lib/email/send", () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a) }));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: (...a: unknown[]) => checkRateLimit(...a),
  _resetRateLimits: vi.fn(),
}));

import { POST as ACCEPT } from "./accept/route";
import { POST as COUNTER } from "./counter/route";
import { POST as DECLINE } from "./decline/route";

function jsonReq(body: unknown): Request {
  return new Request("http://x/api/outreach/tok/x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

const params = { params: Promise.resolve({ token: "tok" }) };

const BRAND_EMAIL = "brand@example.com";
const BRAND_PROFILE_PHONE = "+14155550100";
const BRAND_USER_PHONE = "+14155550199";
const BRAND_STRIPE_CUSTOMER = "cus_brand_secret";
const BRAND_CONNECT_ACCOUNT = "acct_brand_secret";
const BRAND_EXCLUSION = "secret-exclusion";

const BRAND_PROFILE_SELECT = "user_id, brand_name, brand_identity, brand_website";
const BRAND_USER_SELECT = "id, email, full_name, company_name";

function collectKeys(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, found);
    return found;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      found.push(key);
      collectKeys(child, found);
    }
  }
  return found;
}

function expectNoBrandContact(body: unknown) {
  const json = JSON.stringify(body);
  expect(json).not.toContain(BRAND_EMAIL);
  expect(json).not.toContain(BRAND_PROFILE_PHONE);
  expect(json).not.toContain(BRAND_USER_PHONE);
  expect(json).not.toContain(BRAND_STRIPE_CUSTOMER);
  expect(json).not.toContain(BRAND_CONNECT_ACCOUNT);
  expect(json).not.toContain(BRAND_EXCLUSION);
  const keys = collectKeys(body);
  expect(keys).not.toContain("email");
  expect(keys).not.toContain("phone");
}

function expectNarrowSelects() {
  expect(adminBuilder.select.mock.calls.map((call) => call[0])).toEqual([
    BRAND_PROFILE_SELECT,
    BRAND_USER_SELECT,
  ]);
}

const baseOutreach = {
  id: "o1",
  brand_profile_id: "bp1",
  campaign_id: "c1",
  show_name: "Daily Briefing",
  sent_to_email: "host@daily.fm",
  proposed_cpm: 28,
  proposed_episode_count: 3,
  proposed_placement: "mid-roll",
  proposed_flight_start: "2026-05-01",
  proposed_flight_end: "2026-05-31",
  pitch_body: "long pitch body",
  response_status: "pending",
  token: "tok",
  created_at: "",
  updated_at: "",
};

beforeEach(() => {
  vi.clearAllMocks();
  verifyOutreachToken.mockReturnValue({ outreach_id: "o1", iat: 0, v: 1 });
  isOutreachOpen.mockImplementation((s: string) => s === "pending");
  checkRateLimit.mockReturnValue({ ok: true, remaining: 4, retryAfterSec: 0 });
  getOutreachById.mockResolvedValue({ ...baseOutreach });
  getCampaignById.mockResolvedValue({ id: "c1", user_id: "u1", name: "Spring Launch" });
  updateOutreachResponse.mockImplementation(async (id: string, patch: object) => ({
    ...baseOutreach,
    ...patch,
    id,
  }));

  // First admin lookup → brand_profile, second → user profile
  adminBuilder.single
    .mockResolvedValueOnce({
      data: {
        id: "bp1",
        user_id: "u1",
        brand_name: "Aurora",
        brand_identity: "Aurora Sleep, sold direct",
        brand_website: "https://x",
        phone: BRAND_PROFILE_PHONE,
        target_customer: "secret-customer",
        exclusions: BRAND_EXCLUSION,
        stripe_customer_id: BRAND_STRIPE_CUSTOMER,
      },
      error: null,
    })
    .mockResolvedValueOnce({
      data: {
        id: "u1",
        email: BRAND_EMAIL,
        phone: BRAND_USER_PHONE,
        role: "brand",
        full_name: "Brand",
        company_name: "Aurora",
        stripe_customer_id: BRAND_STRIPE_CUSTOMER,
        stripe_connect_account_id: BRAND_CONNECT_ACCOUNT,
        platform_fee_percentage: 0.1,
        company_url: "https://billing.example",
      },
      error: null,
    });
  // Wave 12: show profile lookup is a maybeSingle on profiles table for the
  // sent_to_email. Default to "no onboarded show found" — the deal is now still
  // created at accept time (show_profile_id NULL, backfilled at onboarding).
  adminBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });
  getWave12DealByOutreachId.mockResolvedValue(null);
  resolveOrMaterializeShowIdForOutreach.mockResolvedValue("show-mat-1");
  // Accept now creates the deal BEFORE flipping the outreach to accepted
  // (atomicity), so the accept path needs a deal to come back.
  createWave12Deal.mockResolvedValue({
    id: "deal-acc-1",
    outreach_id: "o1",
    brand_profile_id: "bp1",
    show_profile_id: null,
    agreed_cpm: 28,
    agreed_episode_count: 3,
    agreed_placement: "mid-roll",
    agreed_flight_start: "2026-05-01",
    agreed_flight_end: "2026-05-31",
    status: "planning",
    created_at: "",
    updated_at: "",
  });
});

describe("POST /api/outreach/[token]/accept", () => {
  it("rejects an invalid token", async () => {
    verifyOutreachToken.mockReturnValueOnce(null);
    const res = await ACCEPT(jsonReq({}) as never, params as never);
    expect(res.status).toBe(401);
  });

  it("rejects when already responded", async () => {
    getOutreachById.mockResolvedValueOnce({ ...baseOutreach, response_status: "accepted" });
    const res = await ACCEPT(jsonReq({}) as never, params as never);
    expect(res.status).toBe(409);
  });

  it("rejects when rate-limited", async () => {
    checkRateLimit.mockReturnValueOnce({ ok: false, remaining: 0, retryAfterSec: 30 });
    const res = await ACCEPT(jsonReq({}) as never, params as never);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
  });

  it("updates outreach to accepted and notifies brand", async () => {
    const res = await ACCEPT(jsonReq({}) as never, params as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.outreach.response_status).toBe("accepted");
    expect(body.outreach.token).toBe("");
    expect(updateOutreachResponse).toHaveBeenCalled();
    expect(sendEmail).toHaveBeenCalled();
    const sendArgs = sendEmail.mock.calls[0][0];
    expect(sendArgs.to).toBe(BRAND_EMAIL);
    expect(sendArgs.recipientProfileId).toBe("u1");
    expect(sendArgs.subject).toMatch(/Accepted/);
    expectNoBrandContact(body);
    expectNarrowSelects();
  });

  it("does not return the brand email or phone", async () => {
    const res = await ACCEPT(jsonReq({}) as never, params as never);
    expect(res.status).toBe(200);
    expectNoBrandContact(await res.json());
    expectNarrowSelects();
    expect(sendEmail.mock.calls[0][0].to).toBe(BRAND_EMAIL);
  });

  it("treats a profile row with no email as missing", async () => {
    adminBuilder.single.mockReset();
    adminBuilder.single
      .mockResolvedValueOnce({
        data: { user_id: "u1", brand_name: "Aurora" },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { id: "u1", email: "", full_name: "Brand", phone: BRAND_USER_PHONE },
        error: null,
      });
    const res = await ACCEPT(jsonReq({}) as never, params as never);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "Brand user missing" });
    expect(JSON.stringify(body)).not.toContain(BRAND_USER_PHONE);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("creates the deal at accept time even when the show hasn't onboarded", async () => {
    // Decision 1: NOT-NULL brand_id/show_id are always set; show_profile_id is
    // NULL when the show isn't onboarded yet (backfilled later).
    await ACCEPT(jsonReq({}) as never, params as never);
    expect(createWave12Deal).toHaveBeenCalledWith(
      expect.objectContaining({
        brand_id: "u1",
        show_id: "show-mat-1",
        show_profile_id: null,
        agreed_cpm: 28,
      })
    );
  });
});

describe("POST /api/outreach/[token]/counter", () => {
  it("requires positive counter_cpm", async () => {
    const res = await COUNTER(jsonReq({ counter_cpm: -1 }) as never, params as never);
    expect(res.status).toBe(400);
  });

  it("records counter and notifies brand", async () => {
    const res = await COUNTER(
      jsonReq({ counter_cpm: 32, counter_message: "4-spot minimum" }) as never,
      params as never
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.outreach.response_status).toBe("countered");
    expect(body.outreach.token).toBe("");
    const update = updateOutreachResponse.mock.calls[0][1];
    expect(update.response_status).toBe("countered");
    expect(update.counter_cpm).toBe(32);
    expect(update.counter_message).toBe("4-spot minimum");
    expectNoBrandContact(body);
    expectNarrowSelects();
  });

  it("does not return the brand email or phone", async () => {
    const res = await COUNTER(
      jsonReq({ counter_cpm: 32, counter_message: "4-spot minimum" }) as never,
      params as never
    );
    expect(res.status).toBe(200);
    expectNoBrandContact(await res.json());
    expectNarrowSelects();
  });

  it("stores and emails a stripped counter message", async () => {
    const res = await COUNTER(
      jsonReq({
        counter_cpm: 32,
        counter_message: "Email ada@example.test or call (555) 555-0199. Price stays $25 CPM.",
      }) as never,
      params as never
    );
    expect(res.status).toBe(200);
    const update = updateOutreachResponse.mock.calls[0][1];
    expect(update.counter_message).not.toContain("ada@example.test");
    expect(update.counter_message).not.toContain("555");
    expect(update.counter_message).toContain("$25 CPM");
    const sent = sendEmail.mock.calls[0][0];
    expect(sent.html).not.toContain("ada@example.test");
    expect(sent).not.toHaveProperty("attachments");
  });
});

describe("POST /api/outreach/[token]/decline", () => {
  it("declines without reason", async () => {
    const res = await DECLINE(jsonReq({}) as never, params as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.outreach.response_status).toBe("declined");
    expect(body.outreach.token).toBe("");
    const update = updateOutreachResponse.mock.calls[0][1];
    expect(update.response_status).toBe("declined");
    expect(update.decline_reason).toBeNull();
    expectNoBrandContact(body);
    expectNarrowSelects();
  });

  it("does not return the brand email or phone", async () => {
    const res = await DECLINE(jsonReq({}) as never, params as never);
    expect(res.status).toBe(200);
    expectNoBrandContact(await res.json());
    expectNarrowSelects();
  });

  it("declines with reason", async () => {
    const res = await DECLINE(
      jsonReq({ decline_reason: "Not a fit" }) as never,
      params as never
    );
    expect(res.status).toBe(200);
    expect(updateOutreachResponse.mock.calls[0][1].decline_reason).toBe("Not a fit");
  });

  it("stores and emails a stripped decline reason", async () => {
    const res = await DECLINE(
      jsonReq({ decline_reason: "Write ada@example.test instead." }) as never,
      params as never
    );
    expect(res.status).toBe(200);
    expect(updateOutreachResponse.mock.calls[0][1].decline_reason).not.toContain("ada@example.test");
    expect(sendEmail.mock.calls[0][0].html).not.toContain("ada@example.test");
    expect(sendEmail.mock.calls[0][0]).not.toHaveProperty("attachments");
  });
});
