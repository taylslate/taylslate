import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockGetAuthenticatedUser, mockGetCampaignById, mockLogEvent, mockCallLLM } =
  vi.hoisted(() => ({
    mockGetAuthenticatedUser: vi.fn(),
    mockGetCampaignById: vi.fn(),
    mockLogEvent: vi.fn(),
    mockCallLLM: vi.fn(),
  }));

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: mockGetAuthenticatedUser,
  getCampaignById: mockGetCampaignById,
}));

vi.mock("@/lib/data/events", () => ({
  logEvent: mockLogEvent,
}));

vi.mock("@/lib/llm/client", () => ({
  callLLMWithFallback: mockCallLLM,
  createLLMClient: vi.fn(() => ({})),
  loadPrompt: vi.fn(() => "system prompt"),
}));

import { POST } from "./route";

const USER = { id: "user_1", email: "brand@example.com" };
const CAMPAIGN = { id: "camp_1", user_id: "user_1" };

// Deterministic LLM response fixtures (spec: no real API calls in CI).
const ECOMMERCE_DERIVATION = {
  brand_name: "SaunaBox",
  category: "premium wellness",
  product_description:
    "Portable infrared sauna kits for at-home recovery. Sold D2C from $399 to $2,799.",
  aov_bucket: "high",
  aov_reasoning: "Kits listed at $399-$2,799; flagship bundle is $1,299.",
  key_attributes: ["mobile use case", "premium price point", "recovery positioning"],
};

const SAAS_DERIVATION = {
  brand_name: "PipelineIQ",
  category: "B2B sales software",
  product_description: "Sales-forecasting platform for mid-market revenue teams.",
  aov_bucket: "high",
  aov_reasoning:
    "No visible pricing ('talk to sales'); inferred from enterprise positioning and role-based ICP.",
  key_attributes: ["annual contract", "role-based ICP", "enterprise positioning"],
};

function llmMessage(text: string, stopReason = "end_turn") {
  return { stop_reason: stopReason, content: [{ type: "text", text }] };
}

function jsonReq(body: unknown): Request {
  return new Request("http://x/api/campaigns/camp_1/derive-product", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function call(body: unknown, id = "camp_1") {
  return POST(jsonReq(body) as never, { params: Promise.resolve({ id }) });
}

function stubFetch(impl: () => Promise<unknown>) {
  vi.stubGlobal("fetch", vi.fn(impl));
}

function htmlResponse(html: string, ok = true, status = 200) {
  return { ok, status, text: async () => html };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthenticatedUser.mockResolvedValue(USER);
  mockGetCampaignById.mockResolvedValue(CAMPAIGN);
  mockLogEvent.mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /api/campaigns/[id]/derive-product", () => {
  it("derives all fields from a clean e-commerce homepage", async () => {
    stubFetch(async () =>
      htmlResponse("<html><body><h1>SaunaBox</h1><p>From $399</p></body></html>")
    );
    mockCallLLM.mockResolvedValue(llmMessage(JSON.stringify(ECOMMERCE_DERIVATION)));

    const res = await call({ url: "https://saunabox.com" });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual(ECOMMERCE_DERIVATION);
    expect(mockLogEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "brief.url_derived",
        entityType: "campaign",
        entityId: "camp_1",
        actorId: USER.id,
      })
    );
    // Page text (HTML-stripped) reaches the LLM
    expect(mockCallLLM.mock.calls[0][0].userContent).toContain("SaunaBox");
    expect(mockCallLLM.mock.calls[0][0].userContent).not.toContain("<h1>");
  });

  it("derives aov_bucket from positioning cues on a SaaS landing page", async () => {
    stubFetch(async () =>
      htmlResponse("<html><body>PipelineIQ — talk to sales</body></html>")
    );
    mockCallLLM.mockResolvedValue(llmMessage(JSON.stringify(SAAS_DERIVATION)));

    const body = await (await call({ url: "https://pipelineiq.com" })).json();

    expect(body.aov_bucket).toBe("high");
    expect(body.aov_reasoning).toContain("inferred");
  });

  it("returns url_unreachable on a 404", async () => {
    stubFetch(async () => htmlResponse("Not found", false, 404));

    const res = await call({ url: "https://saunabox.com/missing" });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ error: "url_unreachable", fallback_required: true });
    expect(mockCallLLM).not.toHaveBeenCalled();
    expect(mockLogEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "brief.url_derivation_failed" })
    );
  });

  it("returns url_unreachable on a fetch timeout", async () => {
    stubFetch(async () => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    });

    const body = await (await call({ url: "https://slow.example.com" })).json();
    expect(body).toEqual({ error: "url_unreachable", fallback_required: true });
  });

  it("rejects non-http(s) URLs as unreachable without fetching", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const body = await (await call({ url: "file:///etc/passwd" })).json();
    expect(body).toEqual({ error: "url_unreachable", fallback_required: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns derivation_failed when the LLM emits malformed JSON", async () => {
    stubFetch(async () => htmlResponse("<html><body>SaunaBox</body></html>"));
    mockCallLLM.mockResolvedValue(llmMessage("Sure! Here's the derivation: {brand"));

    const res = await call({ url: "https://saunabox.com" });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ error: "derivation_failed" });
    expect(mockLogEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "brief.url_derivation_failed",
        payload: { reason: "malformed_json" },
      })
    );
  });

  it("returns derivation_failed when the LLM still refuses after fallback", async () => {
    stubFetch(async () => htmlResponse("<html><body>SaunaBox</body></html>"));
    mockCallLLM.mockResolvedValue(llmMessage("", "refusal"));

    const body = await (await call({ url: "https://saunabox.com" })).json();
    expect(body).toEqual({ error: "derivation_failed" });
  });

  it("parses fenced JSON and normalizes medium → mid", async () => {
    stubFetch(async () => htmlResponse("<html><body>Acme</body></html>"));
    mockCallLLM.mockResolvedValue(
      llmMessage(
        "```json\n" +
          JSON.stringify({ ...ECOMMERCE_DERIVATION, aov_bucket: "medium" }) +
          "\n```"
      )
    );

    const body = await (await call({ url: "https://acme.com" })).json();
    expect(body.aov_bucket).toBe("mid");
    expect(body.brand_name).toBe("SaunaBox");
  });

  it("fills missing fields with empty values and logs a warning", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    stubFetch(async () => htmlResponse("<html><body>Acme</body></html>"));
    mockCallLLM.mockResolvedValue(
      llmMessage(JSON.stringify({ brand_name: "Acme", aov_bucket: "low" }))
    );

    const body = await (await call({ url: "https://acme.com" })).json();

    expect(body.brand_name).toBe("Acme");
    expect(body.category).toBe("");
    expect(body.product_description).toBe("");
    expect(body.aov_reasoning).toBe("");
    expect(body.key_attributes).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("missing field"),
    );
    warnSpy.mockRestore();
  });

  it("derives from a pasted paragraph without fetching", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    mockCallLLM.mockResolvedValue(llmMessage(JSON.stringify(ECOMMERCE_DERIVATION)));

    const body = await (
      await call({ paragraph: "SaunaBox sells portable infrared saunas from $399." })
    ).json();

    expect(body).toEqual(ECOMMERCE_DERIVATION);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mockCallLLM.mock.calls[0][0].userContent).toContain("SaunaBox");
  });

  it("returns 400 when neither url nor paragraph is provided", async () => {
    const res = await call({});
    expect(res.status).toBe(400);
  });

  it("returns 401 when unauthenticated", async () => {
    mockGetAuthenticatedUser.mockResolvedValue(null);
    const res = await call({ url: "https://saunabox.com" });
    expect(res.status).toBe(401);
  });

  it("returns 404 when the campaign belongs to another user", async () => {
    mockGetCampaignById.mockResolvedValue({ id: "camp_1", user_id: "someone_else" });
    const res = await call({ url: "https://saunabox.com" });
    expect(res.status).toBe(404);
  });
});
