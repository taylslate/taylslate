import { beforeEach, describe, expect, it, vi } from "vitest";

const BRAND = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const ACTION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const PATTERN = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const CAMPAIGN = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
const NOW = "2026-06-15T15:00:00.000Z";

const { createCampaign, getCampaignPatternById, logEvent, row } = vi.hoisted(() => ({
  createCampaign: vi.fn(),
  getCampaignPatternById: vi.fn(),
  logEvent: vi.fn(),
  row: {
    current: null as Record<string, unknown> | null,
  },
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: () => builder(),
  },
}));
vi.mock("@/lib/data/queries", () => ({
  createCampaign: (...args: unknown[]) => createCampaign(...args),
}));
vi.mock("@/lib/data/reasoning-log", () => ({
  getCampaignPatternById: (...args: unknown[]) => getCampaignPatternById(...args),
}));
vi.mock("@/lib/data/events", () => ({
  logEvent: (...args: unknown[]) => logEvent(...args),
}));

import { campaignName, EXECUTION_ERROR, executeApprovedCampaign } from "@/lib/api/approvals/execute";
import type { CampaignCreatePayload } from "@/lib/api/v1/writes";

function builder() {
  const filters: Array<(record: Record<string, unknown>) => boolean> = [];
  let patch: Record<string, unknown> | null = null;
  const api = {
    select() {
      return api;
    },
    update(next: Record<string, unknown>) {
      patch = next;
      return api;
    },
    eq(column: string, value: unknown) {
      filters.push((record) => record[column] === value);
      return api;
    },
    is(column: string, value: unknown) {
      filters.push((record) => (value === null ? record[column] == null : record[column] === value));
      return api;
    },
    or(expression: string) {
      filters.push((record) => matchOr(record, expression));
      return api;
    },
    maybeSingle() {
      return Promise.resolve().then(() => apply());
    },
    then(onFulfilled: (value: unknown) => unknown) {
      return Promise.resolve().then(() => onFulfilled(apply()));
    },
  };

  function apply() {
    const current = row.current;
    const matched = current != null && filters.every((filter) => filter(current));
    if (matched && patch && current) Object.assign(current, patch);
    return { data: matched && current ? { ...current } : null, error: null };
  }

  return api;
}

function matchOr(record: Record<string, unknown>, expression: string): boolean {
  return expression.split(",").some((part) => {
    if (part.includes("execution_started_at.is.null")) return record.execution_started_at == null;
    const lt = part.match(/execution_started_at\.lt\.(?:"([^"]+)"|([^,]+))/);
    if (!lt || record.execution_started_at == null) return false;
    return String(record.execution_started_at) < (lt[1] ?? lt[2]);
  });
}

function baseRow(): Record<string, unknown> {
  return {
    id: ACTION,
    brand_id: BRAND,
    kind: "campaign.create",
    status: "approved",
    payload: {
      product: {
        brand_name: "Sauna Box",
        category: "Home",
        product_description: "A home sauna kit.",
        aov_bucket: "high",
        aov_reasoning: "Kits sell above two hundred dollars.",
        key_attributes: ["home"],
        source: "url",
        url: "https://saunabox.example",
      },
      customer_text: "SECRET_CUSTOMER_TEXT",
      goals: ["test_channel"],
      budget_total: 25000,
      flight: { mode: "preset", preset: "next_30_days" },
    },
    result_campaign_id: null,
    execution_started_at: null,
    execution_error: null,
    executed_at: null,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
  createCampaign.mockReset();
  getCampaignPatternById.mockReset();
  logEvent.mockReset();
  createCampaign.mockResolvedValue({ id: CAMPAIGN });
  getCampaignPatternById.mockResolvedValue(null);
  logEvent.mockResolvedValue(null);
  row.current = baseRow();
});

describe("campaignName", () => {
  it("uses a hyphen where the manual brief uses an em dash", () => {
    const payload = baseRow().payload as CampaignCreatePayload;
    const name = campaignName(payload, null, new Date(NOW));
    expect(name).toBe("Sauna Box - June 2026");
    expect(name).not.toContain("\u2014");
  });

  it("reads the brand from an owned pattern when the payload has none", () => {
    const payload = {
      goals: ["scale_winner"],
      budget_total: 20000,
      flight: { mode: "preset", preset: "asap" },
      customer_context: { reused_from_pattern_id: PATTERN },
    } as CampaignCreatePayload;
    const name = campaignName(
      payload,
      {
        id: PATTERN,
        campaign_id: null,
        customer_id: BRAND,
        created_at: NOW,
        product_attributes: { brand_name: "Pattern Brand" },
        customer_description: null,
        aov_bucket: null,
        scoring_weights: null,
      },
      new Date(NOW)
    );
    expect(name).toBe("Pattern Brand - June 2026");
  });
});

describe("executeApprovedCampaign", () => {
  it("creates one draft through the manual brief shape", async () => {
    const result = await executeApprovedCampaign({ userId: BRAND, actionId: ACTION });
    expect(result).toEqual({ ok: true, campaignId: CAMPAIGN });
    expect(createCampaign).toHaveBeenCalledTimes(1);
    const args = createCampaign.mock.calls[0][0];
    expect(args.status).toBe("draft");
    expect(args.platforms).toEqual(["podcast", "youtube"]);
    expect(args.recommendations).toEqual([]);
    expect(args.brief.version).toBe(2);
    expect(args.brief.goals).toEqual(["test_channel"]);
    expect(args.brief.customer_text).toBe("SECRET_CUSTOMER_TEXT");
    expect(args.brief.budget_total).toBeUndefined();
    expect(args.brief.submitted_at).toBe(NOW);
    expect(row.current?.result_campaign_id).toBe(CAMPAIGN);
    expect(JSON.stringify(logEvent.mock.calls)).not.toContain("SECRET_CUSTOMER_TEXT");
    expect(logEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "brief.submitted",
      payload: expect.objectContaining({ source: "api_action", action_id: ACTION }),
    }));
  });

  it("does not create a campaign for a missing or foreign pattern", async () => {
    const payload = row.current?.payload as Record<string, unknown>;
    payload.customer_context = { reused_from_pattern_id: PATTERN };
    getCampaignPatternById.mockResolvedValueOnce(null);
    const missing = await executeApprovedCampaign({ userId: BRAND, actionId: ACTION });
    expect(missing.ok).toBe(false);
    expect(createCampaign).not.toHaveBeenCalled();
    expect(row.current?.execution_error).toBe(EXECUTION_ERROR);
    expect(row.current?.status).toBe("approved");

    row.current = baseRow();
    (row.current.payload as Record<string, unknown>).customer_context = {
      reused_from_pattern_id: PATTERN,
    };
    getCampaignPatternById.mockResolvedValueOnce({
      id: PATTERN,
      customer_id: OTHER,
      product_attributes: {},
    });
    const foreign = await executeApprovedCampaign({ userId: BRAND, actionId: ACTION });
    expect(foreign.ok).toBe(false);
    expect(createCampaign).not.toHaveBeenCalled();
    expect(String((foreign as { ok: false }).ok)).toBe("false");
    expect(JSON.stringify(foreign)).not.toMatch(/duplicate key|violates/);
  });

  it("keeps a thrown database message out of the stored error", async () => {
    createCampaign.mockRejectedValueOnce(new Error("duplicate key value violates unique constraint"));
    const result = await executeApprovedCampaign({ userId: BRAND, actionId: ACTION });
    expect(result.ok).toBe(false);
    expect(row.current?.execution_error).toBe(EXECUTION_ERROR);
    expect(row.current?.execution_error).not.toMatch(/duplicate|constraint/);
    expect(JSON.stringify(logEvent.mock.calls)).not.toMatch(/duplicate|constraint/);
  });

  it("lets two concurrent calls create one campaign", async () => {
    let created = 0;
    createCampaign.mockImplementation(async () => {
      created += 1;
      await Promise.resolve();
      return { id: CAMPAIGN };
    });
    const [left, right] = await Promise.all([
      executeApprovedCampaign({ userId: BRAND, actionId: ACTION }),
      executeApprovedCampaign({ userId: BRAND, actionId: ACTION }),
    ]);
    expect(created).toBe(1);
    expect([left, right].filter((result) => result.ok)).toHaveLength(1);
    expect(row.current?.result_campaign_id).toBe(CAMPAIGN);
  });
});
