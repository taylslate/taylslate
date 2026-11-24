import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getAuthenticatedUser,
  getCampaignById,
  updateCampaignSelections,
  pitchableShowIds,
} = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  getCampaignById: vi.fn(),
  updateCampaignSelections: vi.fn(),
  pitchableShowIds: vi.fn(),
}));

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: (...a: unknown[]) => getAuthenticatedUser(...a),
  getCampaignById: (...a: unknown[]) => getCampaignById(...a),
  updateCampaignSelections: (...a: unknown[]) => updateCampaignSelections(...a),
}));
vi.mock("@/lib/relay/recipient", () => ({
  pitchableShowIds: (...a: unknown[]) => pitchableShowIds(...a),
}));

import { PUT } from "./route";

const USER = "brand-1";
const SHOW = "11111111-1111-4111-8111-111111111111";
const ROSTER = "22222222-2222-4222-8222-222222222222";
const HIDDEN = "33333333-3333-4333-8333-333333333333";
const PODSCAN = "pd_daily";

function put(body: unknown) {
  return PUT(
    new Request("http://x/api/campaigns/selections", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }) as never
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getAuthenticatedUser.mockResolvedValue({ id: USER });
  getCampaignById.mockResolvedValue({
    id: "camp-1",
    user_id: USER,
    scored_shows: [{ podcastId: PODSCAN }, { podcastId: SHOW }],
  });
  updateCampaignSelections.mockResolvedValue(true);
  pitchableShowIds.mockImplementation(async (_userId: string, ids: string[]) => new Set(ids.filter((id) => id !== HIDDEN)));
});

describe("PUT /api/campaigns/selections", () => {
  it("keeps the 401, the JSON 400, and the missing campaign id", async () => {
    getAuthenticatedUser.mockResolvedValueOnce(null);
    const denied = await put({ campaign_id: "camp-1", selected_show_ids: [] });
    expect(denied.status).toBe(401);

    const badJson = await PUT(
      new Request("http://x/api/campaigns/selections", {
        method: "PUT",
        body: "{",
      }) as never
    );
    expect(badJson.status).toBe(400);
    expect(await badJson.json()).toEqual({ error: "Invalid JSON" });

    const missing = await put({ selected_show_ids: [SHOW] });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: "campaign_id required" });
    expect(updateCampaignSelections).not.toHaveBeenCalled();
  });

  it("rejects a malformed or oversized list and writes nothing", async () => {
    const cases = [
      { campaign_id: "camp-1", selected_show_ids: "nope" },
      { campaign_id: "camp-1", selected_show_ids: [""] },
      { campaign_id: "camp-1", selected_show_ids: ["x".repeat(201)] },
      { campaign_id: "camp-1", selected_show_ids: [1] },
      { campaign_id: "camp-1", selected_show_ids: Array.from({ length: 201 }, () => SHOW) },
    ];
    for (const body of cases) {
      const res = await put(body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Invalid selection" });
    }
    expect(updateCampaignSelections).not.toHaveBeenCalled();
  });

  it("returns 404 for a missing or foreign campaign", async () => {
    getCampaignById.mockResolvedValueOnce(null);
    const missing = await put({ campaign_id: "camp-x", selected_show_ids: [] });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "Campaign not found" });

    getCampaignById.mockResolvedValueOnce({ id: "camp-1", user_id: "someone-else", scored_shows: [] });
    const foreign = await put({ campaign_id: "camp-1", selected_show_ids: [SHOW] });
    expect(foreign.status).toBe(404);
    expect(updateCampaignSelections).not.toHaveBeenCalled();
  });

  it("rejects a hidden show and does not name it", async () => {
    const res = await put({ campaign_id: "camp-1", selected_show_ids: [SHOW, HIDDEN] });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: "Show not found" });
    expect(JSON.stringify(body)).not.toContain(HIDDEN);
    expect(updateCampaignSelections).not.toHaveBeenCalled();
  });

  it("accepts a roster show and an accepted-outreach show", async () => {
    pitchableShowIds.mockResolvedValue(new Set([SHOW, ROSTER]));
    const res = await put({ campaign_id: "camp-1", selected_show_ids: [ROSTER, SHOW, SHOW] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(updateCampaignSelections).toHaveBeenCalledWith("camp-1", [ROSTER, SHOW]);
    expect(pitchableShowIds).toHaveBeenCalledWith(USER, [ROSTER, SHOW]);
  });

  it("accepts a Podscan id only when it is already on scored_shows", async () => {
    const ok = await put({ campaign_id: "camp-1", selected_show_ids: [PODSCAN] });
    expect(ok.status).toBe(200);
    expect(updateCampaignSelections).toHaveBeenCalledWith("camp-1", [PODSCAN]);

    updateCampaignSelections.mockClear();
    const missing = await put({ campaign_id: "camp-1", selected_show_ids: ["pd_other"] });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: "Show not found" });
    expect(updateCampaignSelections).not.toHaveBeenCalled();
  });
});
