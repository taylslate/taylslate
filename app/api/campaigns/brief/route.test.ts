import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockGetAuthenticatedUser,
  mockGetCampaignById,
  mockCreateCampaign,
  mockUpdateCampaignBrief,
  mockEnsureProfile,
  mockLogEvent,
  mockGetCampaignPatternById,
  mockGetRecentUnsubmittedDraft,
} = vi.hoisted(() => ({
  mockGetAuthenticatedUser: vi.fn(),
  mockGetCampaignById: vi.fn(),
  mockCreateCampaign: vi.fn(),
  mockUpdateCampaignBrief: vi.fn(),
  mockEnsureProfile: vi.fn(),
  mockLogEvent: vi.fn(),
  mockGetCampaignPatternById: vi.fn(),
  mockGetRecentUnsubmittedDraft: vi.fn(),
}));

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: mockGetAuthenticatedUser,
  getCampaignById: mockGetCampaignById,
  createCampaign: mockCreateCampaign,
  updateCampaignBrief: mockUpdateCampaignBrief,
  ensureProfile: mockEnsureProfile,
  getRecentUnsubmittedDraft: mockGetRecentUnsubmittedDraft,
}));

vi.mock("@/lib/data/events", () => ({
  logEvent: mockLogEvent,
}));

vi.mock("@/lib/data/reasoning-log", () => ({
  getCampaignPatternById: mockGetCampaignPatternById,
}));

import { POST } from "./route";

const USER = { id: "user_1", email: "brand@example.com" };

const PRODUCT = {
  brand_name: "SaunaBox",
  category: "premium wellness",
  product_description: "Portable infrared sauna kits.",
  aov_bucket: "high",
  aov_reasoning: "Kits listed at $399-$2,799.",
  key_attributes: ["mobile use case", "premium price point"],
  source: "url",
  url: "https://saunabox.com",
};

const VALID_SUBMIT = {
  stage: "submit",
  product: PRODUCT,
  customer_text: "Affluent men 30-55 into recovery and biohacking.",
  goals: ["test_channel", "direct_response"],
  budget_total: 25000,
  flight: { mode: "preset", preset: "next_30_days" },
  exclusions_text: "No competitor sauna brands.",
};

function call(body: unknown) {
  return POST(
    new Request("http://x/api/campaigns/brief", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }) as never
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthenticatedUser.mockResolvedValue(USER);
  mockEnsureProfile.mockResolvedValue({ id: USER.id });
  mockCreateCampaign.mockResolvedValue({ id: "camp_new", user_id: USER.id });
  mockUpdateCampaignBrief.mockResolvedValue(true);
  mockLogEvent.mockResolvedValue(null);
  mockGetRecentUnsubmittedDraft.mockResolvedValue(null);
});

describe("POST /api/campaigns/brief", () => {
  it("rejects unauthenticated requests", async () => {
    mockGetAuthenticatedUser.mockResolvedValue(null);
    const res = await call({ stage: "draft" });
    expect(res.status).toBe(401);
  });

  it("creates a minimal draft campaign and returns its id", async () => {
    const res = await call({ stage: "draft" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ campaign_id: "camp_new" });
    expect(mockEnsureProfile).toHaveBeenCalledWith(USER);
    expect(mockCreateCampaign).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: USER.id,
        name: "Untitled campaign",
        budget_total: 0,
        status: "draft",
        brief: { version: 2 },
      })
    );
  });

  it("draft with existing campaign_id is a no-op returning the same id", async () => {
    mockGetCampaignById.mockResolvedValue({ id: "camp_1", user_id: USER.id });
    const res = await call({ stage: "draft", campaign_id: "camp_1" });
    expect(await res.json()).toEqual({ campaign_id: "camp_1" });
    expect(mockCreateCampaign).not.toHaveBeenCalled();
  });

  it("404s when the campaign belongs to another user", async () => {
    mockGetCampaignById.mockResolvedValue({ id: "camp_1", user_id: "other" });
    const res = await call({ ...VALID_SUBMIT, campaign_id: "camp_1" });
    expect(res.status).toBe(404);
  });

  it("submit updates an existing draft with the v2 brief and derived name", async () => {
    mockGetCampaignById.mockResolvedValue({ id: "camp_1", user_id: USER.id });
    const res = await call({ ...VALID_SUBMIT, campaign_id: "camp_1" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ campaign_id: "camp_1" });

    const [id, updates] = mockUpdateCampaignBrief.mock.calls[0];
    expect(id).toBe("camp_1");
    expect(updates.name).toMatch(/^SaunaBox — /);
    expect(updates.budget_total).toBe(25000);
    expect(updates.brief.version).toBe(2);
    expect(updates.brief.product.brand_name).toBe("SaunaBox");
    expect(updates.brief.submitted_at).toBeTruthy();
  });

  it("submit without campaign_id creates the row in one shot (check-in path)", async () => {
    mockGetCampaignPatternById.mockResolvedValue({
      id: "pat_1",
      customer_id: USER.id,
      product_attributes: { brand_name: "SaunaBox" },
      customer_description: "prior customer text",
    });
    const res = await call({
      stage: "submit",
      customer_context: { reused_from_pattern_id: "pat_1", delta_text: "New SKU launched" },
      goals: ["scale_winner"],
      budget_total: 30000,
      flight: { mode: "preset", preset: "asap" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ campaign_id: "camp_new" });

    const created = mockCreateCampaign.mock.calls[0][0];
    expect(created.name).toMatch(/^SaunaBox — /);
    expect(created.brief.customer_context.reused_from_pattern_id).toBe("pat_1");
    expect(created.brief.customer_context.delta_text).toBe("New SKU launched");
  });

  it("reuse exemption: product/customer_text not required when reusing a pattern", async () => {
    mockGetCampaignPatternById.mockResolvedValue({
      id: "pat_1",
      customer_id: USER.id,
      product_attributes: {},
    });
    const res = await call({
      stage: "submit",
      customer_context: { reused_from_pattern_id: "pat_1" },
      goals: ["test_channel"],
      budget_total: 10000,
      flight: { mode: "dates", start_date: "2026-07-01", end_date: "2026-08-15" },
    });
    expect(res.status).toBe(200);
  });

  it("rejects a reused pattern that belongs to another customer", async () => {
    mockGetCampaignPatternById.mockResolvedValue({
      id: "pat_1",
      customer_id: "someone_else",
      product_attributes: {},
    });
    const res = await call({
      stage: "submit",
      customer_context: { reused_from_pattern_id: "pat_1" },
      goals: ["test_channel"],
      budget_total: 10000,
      flight: { mode: "preset", preset: "asap" },
    });
    expect(res.status).toBe(400);
  });

  it("rejects budget below $5,000", async () => {
    const res = await call({ ...VALID_SUBMIT, budget_total: 4999 });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/5,000/);
  });

  it("rejects missing product on a fresh brief", async () => {
    const res = await call({ ...VALID_SUBMIT, product: undefined });
    expect(res.status).toBe(400);
  });

  it("rejects missing customer_text on a fresh brief", async () => {
    const res = await call({ ...VALID_SUBMIT, customer_text: "  " });
    expect(res.status).toBe(400);
  });

  it("rejects zero goals, more than 3 goals, and unknown goals", async () => {
    expect((await call({ ...VALID_SUBMIT, goals: [] })).status).toBe(400);
    expect(
      (
        await call({
          ...VALID_SUBMIT,
          goals: ["test_channel", "scale_winner", "direct_response", "lead_gen"],
        })
      ).status
    ).toBe(400);
    expect((await call({ ...VALID_SUBMIT, goals: ["world_domination"] })).status).toBe(400);
  });

  it("rejects mode-inconsistent flight windows", async () => {
    expect(
      (await call({ ...VALID_SUBMIT, flight: { mode: "preset" } })).status
    ).toBe(400);
    expect(
      (await call({ ...VALID_SUBMIT, flight: { mode: "dates", start_date: "2026-07-01" } }))
        .status
    ).toBe(400);
    expect((await call({ ...VALID_SUBMIT, flight: undefined })).status).toBe(400);
  });

  it("fires brief.submitted with reuse + goals payload", async () => {
    mockGetCampaignById.mockResolvedValue({ id: "camp_1", user_id: USER.id });
    await call({ ...VALID_SUBMIT, campaign_id: "camp_1" });
    expect(mockLogEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "brief.submitted",
        entityType: "campaign",
        entityId: "camp_1",
        actorId: USER.id,
      })
    );
  });

  it("does not fire brief.submitted when validation fails", async () => {
    await call({ ...VALID_SUBMIT, budget_total: 100 });
    expect(mockLogEvent).not.toHaveBeenCalled();
  });

  // ---- Layer 3 amendment: server-side draft idempotency ----

  it("draft without campaign_id reuses a recent unsubmitted draft", async () => {
    mockGetRecentUnsubmittedDraft.mockResolvedValue({
      id: "camp_recent",
      user_id: USER.id,
    });
    const res = await call({ stage: "draft" });
    expect(await res.json()).toEqual({ campaign_id: "camp_recent" });
    expect(mockGetRecentUnsubmittedDraft).toHaveBeenCalledWith(USER.id);
    expect(mockCreateCampaign).not.toHaveBeenCalled();
  });

  it("draft creates a new row when no recent draft exists", async () => {
    const res = await call({ stage: "draft" });
    expect(await res.json()).toEqual({ campaign_id: "camp_new" });
    expect(mockCreateCampaign).toHaveBeenCalled();
  });

  // ---- Layer 3 amendment: ensureProfile failure handling ----

  it("returns 500 when ensureProfile throws, without creating a campaign", async () => {
    mockEnsureProfile.mockRejectedValue(new Error("insert failed"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await call({ stage: "draft" });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to initialize user profile" });
    expect(mockCreateCampaign).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  // ---- Layer 3 amendment: flight date validation ----

  it("rejects an inverted flight date range with a structured error", async () => {
    const res = await call({
      ...VALID_SUBMIT,
      flight: { mode: "dates", start_date: "2026-08-15", end_date: "2026-07-01" },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("flight_end_before_start");
    expect(body.field).toBe("flight");
    expect(body.error).toMatch(/end date/i);
  });

  it("rejects flight dates more than 2 years in the future", async () => {
    const res = await call({
      ...VALID_SUBMIT,
      flight: { mode: "dates", start_date: "2099-01-01", end_date: "2099-02-01" },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("flight_too_far_out");
    expect(body.field).toBe("flight");
  });

  it("rejects malformed flight dates", async () => {
    const res = await call({
      ...VALID_SUBMIT,
      flight: { mode: "dates", start_date: "07/01/2026", end_date: "2026-08-15" },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("flight_invalid_date");
  });

  // ---- Layer 3 amendment: returning-brand field-level changes ----

  const DELTA_SUBMIT = {
    stage: "submit",
    customer_context: {
      reused_from_pattern_id: "pat_1",
      product_url: "https://saunabox.com/v2",
      changed_fields: {
        product_url: {
          before: "https://saunabox.com",
          after: "https://saunabox.com/v2",
        },
        customer_description: {
          before: "Affluent men 30-55.",
          after: "Affluent men and women 30-60 into recovery.",
        },
      },
    },
    customer_text: "Affluent men and women 30-60 into recovery.",
    exclusions_text: "No competitor sauna brands.",
    goals: ["scale_winner"],
    budget_total: 30000,
    flight: { mode: "preset", preset: "asap" },
  };

  it("delta submit stores changed_fields and the new full values", async () => {
    mockGetCampaignPatternById.mockResolvedValue({
      id: "pat_1",
      customer_id: USER.id,
      product_attributes: { brand_name: "SaunaBox" },
    });

    const res = await call(DELTA_SUBMIT);
    expect(res.status).toBe(200);

    const created = mockCreateCampaign.mock.calls[0][0];
    expect(created.brief.customer_text).toBe(
      "Affluent men and women 30-60 into recovery."
    );
    expect(created.brief.exclusions_text).toBe("No competitor sauna brands.");
    expect(created.brief.customer_context).toEqual({
      reused_from_pattern_id: "pat_1",
      product_url: "https://saunabox.com/v2",
      changed_fields: {
        product_url: {
          before: "https://saunabox.com",
          after: "https://saunabox.com/v2",
        },
        customer_description: {
          before: "Affluent men 30-55.",
          after: "Affluent men and women 30-60 into recovery.",
        },
      },
    });
    expect(mockLogEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "brief.submitted",
        payload: expect.objectContaining({
          changed_fields: ["product_url", "customer_description"],
        }),
      })
    );
  });

  it("rejects a malformed changed_fields record", async () => {
    mockGetCampaignPatternById.mockResolvedValue({
      id: "pat_1",
      customer_id: USER.id,
      product_attributes: {},
    });

    const badShapes = [
      { bogus_key: { before: "a", after: "b" } },
      { customer_description: "not an object" },
      { customer_description: { before: 42, after: "x" } },
    ];
    for (const changed_fields of badShapes) {
      const res = await call({
        ...DELTA_SUBMIT,
        customer_context: {
          reused_from_pattern_id: "pat_1",
          changed_fields,
        },
      });
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("invalid_changed_fields");
    }
  });

  it("accepts a brand-confirmed product re-derivation on the delta path", async () => {
    mockGetCampaignPatternById.mockResolvedValue({
      id: "pat_1",
      customer_id: USER.id,
      product_attributes: { brand_name: "SaunaBox" },
    });
    const productAttributes = {
      brand_name: "SaunaBox",
      category: "home spa equipment",
      product_description: "Built-in home spa installs.",
      aov_bucket: "mid",
      aov_reasoning: "Installs from $150.",
      key_attributes: ["home install"],
    };

    const res = await call({
      ...DELTA_SUBMIT,
      customer_context: {
        ...DELTA_SUBMIT.customer_context,
        product_attributes: productAttributes,
      },
    });
    expect(res.status).toBe(200);

    const created = mockCreateCampaign.mock.calls[0][0];
    expect(created.brief.customer_context.product_attributes).toEqual(
      productAttributes
    );
  });

  it("rejects a malformed product_attributes re-derivation", async () => {
    mockGetCampaignPatternById.mockResolvedValue({
      id: "pat_1",
      customer_id: USER.id,
      product_attributes: { brand_name: "SaunaBox" },
    });

    const badShapes = [
      "not an object",
      { brand_name: "", category: "wellness", aov_bucket: "mid" },
      { brand_name: "SaunaBox", category: "  ", aov_bucket: "mid" },
      { brand_name: "SaunaBox", category: "wellness", aov_bucket: "HUGE" },
      {
        brand_name: "SaunaBox",
        category: "wellness",
        aov_bucket: "mid",
        key_attributes: [42],
      },
    ];
    for (const product_attributes of badShapes) {
      const res = await call({
        ...DELTA_SUBMIT,
        customer_context: {
          ...DELTA_SUBMIT.customer_context,
          product_attributes,
        },
      });
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("invalid_product_attributes");
    }
  });

  it("nothing-changed path stays the fast lane (no changed_fields required)", async () => {
    mockGetCampaignPatternById.mockResolvedValue({
      id: "pat_1",
      customer_id: USER.id,
      product_attributes: { brand_name: "SaunaBox" },
    });
    const res = await call({
      stage: "submit",
      customer_context: { reused_from_pattern_id: "pat_1" },
      goals: ["test_channel"],
      budget_total: 10000,
      flight: { mode: "preset", preset: "asap" },
    });
    expect(res.status).toBe(200);
    expect(mockLogEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ changed_fields: [] }),
      })
    );
  });
});
