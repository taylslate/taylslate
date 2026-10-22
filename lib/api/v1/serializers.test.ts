import { describe, expect, it } from "vitest";
import {
  BRIEF_V1_FIELDS,
  BRIEF_V2_FIELDS,
  CAMPAIGN_FIELDS,
  DEAL_FIELDS,
  PLAN_FIELDS,
  PLAN_LINE_FIELDS,
  PRODUCT_FIELDS,
  SCORE_FIELDS,
  SHOW_FIELDS,
  serializeCampaign,
  serializeDeal,
  serializePlan,
  serializeScore,
  serializeShow,
} from "./serializers";

const FORBIDDEN = /stripe|payment|payout|fee|card|setup_intent|envelope/i;

function collectKeys(value: unknown, found: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, found);
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      found.push(key);
      collectKeys(child, found);
    }
  }
}

function expectAllowlist(value: unknown, fields: readonly string[]): void {
  expect(Object.keys(value as object)).toEqual([...fields]);
  const found: string[] = [];
  collectKeys(value, found);
  expect(found.filter((key) => FORBIDDEN.test(key))).toEqual([]);
}

describe("api v1 serializers", () => {
  it("returns exactly the show allowlist and ignores contact and verification columns", () => {
    const show = serializeShow(
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        name: "Launch Notes",
        slug: "launch-notes",
        platform: "podcast",
        categories: ["business"],
        audience_size: "12000",
        description: "Operators",
        image_url: "https://cdn.example/show.png",
        network: "Independent",
        tags: ["saas"],
        demographics: { us: 80, email: "demo@example.com", stripe_customer: "cus" },
        audience_interests: ["software"],
        audience_purchase_power: 70,
        rate_card: { midroll_cpm: 25, contact_email: "rate@example.com", setup_intent_id: "seti" },
        price_type: "cpm",
        min_buy: 500,
        ad_formats: ["host_read"],
        episode_cadence: "weekly",
        avg_episode_length_min: 40,
        current_sponsors: ["Acme"],
        past_sponsors: ["Old"],
        apple_id: "123",
        spotify_id: "abc",
        youtube_channel_id: "UC1",
        rss_url: "https://example.com/rss",
        available_slots: 2,
        next_available_date: "2026-04-01",
        contact_email: "host@example.com",
        contact_name: "Host",
        agent_id: "22222222-2222-4222-8222-222222222222",
        is_verified: true,
        is_discoverable: false,
        data_sources: ["show_owner"],
        stripe_account_id: "acct_secret",
        payment_method_id: "pm_secret",
      },
      false
    );

    expectAllowlist(show, SHOW_FIELDS);
    expect(show.verified).toBe(false);
    expect(show.audience_size).toBe(12000);
    expect(show.rates).toEqual({
      preroll_cpm: null,
      midroll_cpm: 25,
      postroll_cpm: null,
      flat_rate: null,
    });
    expect(show.demographics.us).toBe(80);
    expect(show).not.toHaveProperty("contact_email");
    expect(show).not.toHaveProperty("agent_id");
    expect(show).not.toHaveProperty("is_verified");
    expect(JSON.stringify(show)).not.toContain("host@example.com");
    expect(JSON.stringify(show)).not.toContain("acct_secret");

    expect(serializeShow({ id: "s", name: "S" }, true).verified).toBe(true);
  });

  it("returns exactly the campaign allowlist and drops nested contact fields", () => {
    const campaign = serializeCampaign({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      user_id: "11111111-1111-4111-8111-111111111111",
      name: "Spring",
      status: "planned",
      budget_total: "25000.00",
      platforms: ["podcast"],
      brief: {
        version: 2,
        customer_text: "Founders",
        goals: ["test_channel"],
        goals_context: "First test",
        exclusions_text: "No politics",
        submitted_at: "2026-03-01T00:00:00.000Z",
        contact_email: "brand@example.com",
        stripe_customer: "cus_brand",
        customer_context: { payment_method_id: "pm_1", reused_from_pattern_id: "p1" },
        product: {
          brand_name: "North",
          category: "home",
          product_description: "Sauna",
          aov_bucket: "high",
          aov_reasoning: "Premium",
          key_attributes: ["heat"],
          source: "url",
          url: "https://north.example",
          contact_email: "product@example.com",
          setup_intent_id: "seti_product",
        },
        flight: {
          mode: "dates",
          preset: null,
          start_date: "2026-04-01",
          end_date: "2026-04-30",
          payout_email: "pay@example.com",
        },
      },
      test_spot_count: 3,
      test_placement: "midroll",
      created_at: "2026-03-01T00:00:00.000Z",
      updated_at: "2026-03-02T00:00:00.000Z",
      recommendations: [{ contact_email: "rec@example.com" }],
      media_plan: { setup_intent_id: "seti_plan" },
      scoring_meta: { card_brand: "visa" },
    });

    expectAllowlist(campaign, CAMPAIGN_FIELDS);
    expect(campaign.budget_total).toBe(25000);
    const brief = campaign.brief;
    expect(Object.keys(brief)).toEqual([...BRIEF_V2_FIELDS]);
    if (!("product" in brief) || brief.product == null) {
      throw new Error("expected a v2 product");
    }
    expect(Object.keys(brief.product)).toEqual([...PRODUCT_FIELDS]);
    expect(JSON.stringify(campaign)).not.toContain("brand@example.com");
    expect(JSON.stringify(campaign)).not.toContain("cus_brand");
    expect(JSON.stringify(campaign)).not.toContain("pm_1");
    expect(campaign).not.toHaveProperty("user_id");

    const v1 = serializeCampaign({
      id: "c",
      name: "Draft",
      brief: { brand_url: "https://example.com", contact_email: "a@b.c", stripe: "x" },
    });
    expect(Object.keys(v1.brief)).toEqual([...BRIEF_V1_FIELDS]);
    expect(JSON.stringify(v1.brief)).not.toContain("a@b.c");
  });

  it("returns exactly the score allowlist", () => {
    const score = serializeScore({
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      show_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      ring_hypothesis_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      audience_fit_score: 80,
      topical_relevance_score: 70,
      purchase_power_score: 60,
      composite_score: 72,
      conviction_band: "high",
      reasoning: "Host fit",
      tier: "test",
      created_at: "2026-03-01T00:00:00.000Z",
      per_spot_cents: 2500,
      cpm_used_cents: 2500,
      setup_intent_id: "seti_score",
      shows: { contact_email: "score@example.com", stripe_account: "acct" },
    });
    expectAllowlist(score, SCORE_FIELDS);
    expect(score).not.toHaveProperty("shows");
    expect(score).not.toHaveProperty("setup_intent_id");
    expect(JSON.stringify(score)).not.toContain("score@example.com");
  });

  it("returns exactly the plan allowlist", () => {
    const plan = serializePlan({
      default_placement: "mid-roll",
      default_episodes: 3,
      spacing: "weekly",
      updated_at: "2026-03-01T00:00:00.000Z",
      stripe_price_id: "price_secret",
      line_items: [
        {
          podcast_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          placement: "mid-roll",
          num_episodes: 3,
          addon_surface_ids: ["surface-1"],
          contact_email: "plan@example.com",
          setup_intent_id: "seti_line",
        },
        "skip",
      ],
    });
    if (!plan) throw new Error("expected a plan");
    expectAllowlist(plan, PLAN_FIELDS);
    expect(Object.keys(plan.line_items[0])).toEqual([...PLAN_LINE_FIELDS]);
    expect(JSON.stringify(plan)).not.toContain("plan@example.com");
    expect(JSON.stringify(plan)).not.toContain("price_secret");
    expect(serializePlan(null)).toBeNull();
    expect(serializePlan("nope")).toBeNull();
  });

  it("returns exactly the deal allowlist and keeps the brand rate, not the show net", () => {
    const deal = serializeDeal({
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      campaign_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      show_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      brand_id: "11111111-1111-4111-8111-111111111111",
      brand_profile_id: "33333333-3333-4333-8333-333333333333",
      show_profile_id: "99999999-9999-4999-8999-999999999999",
      agent_id: "agent",
      agency_id: "agency",
      status: "show_signed",
      placement: "mid-roll",
      ad_format: "host_read",
      num_episodes: 3,
      flight_start: "2026-04-01",
      flight_end: "2026-04-30",
      price_type: "cpm",
      cpm_rate: 30,
      gross_cpm: 30,
      gross_per_episode: 300,
      total_gross: 900,
      agreed_cpm: 30,
      guaranteed_downloads: 10000,
      net_per_episode: 270,
      total_net: 810,
      notes: "internal note",
      stripe_payment_intent_id: "pi_secret",
      payment_method_id: "pm_secret",
      payout_id: "po_secret",
      platform_fee_percentage: 6,
      card_on_file_at: "2026-04-02T00:00:00.000Z",
      setup_intent_id: "seti_secret",
      setup_intent_client_secret: "seti_secret_secret",
      docusign_envelope_id: "env_secret",
      signed_io_pdf_url: "https://files.example/io.pdf",
      cancellation_reason: "timeout",
    });

    expectAllowlist(deal, DEAL_FIELDS);
    expect(deal.cpm_rate).toBe(30);
    expect(deal.total_gross).toBe(900);
    expect(deal).not.toHaveProperty("net_per_episode");
    expect(deal).not.toHaveProperty("total_net");
    expect(deal).not.toHaveProperty("notes");
    expect(deal).not.toHaveProperty("brand_profile_id");
    expect(deal).not.toHaveProperty("setup_intent_id");
    expect(JSON.stringify(deal)).not.toContain("pi_secret");
    expect(JSON.stringify(deal)).not.toContain("env_secret");
    expect(JSON.stringify(deal)).not.toContain("internal note");

    const agreed = serializeDeal({
      id: "d",
      placement: null,
      agreed_placement: "pre-roll",
      num_episodes: null,
      agreed_episode_count: 3,
      flight_start: "",
      agreed_flight_start: "2026-05-01",
      flight_end: null,
      agreed_flight_end: "2026-05-31",
      cpm_rate: null,
      agreed_cpm: "25.50",
    });
    expect(agreed.placement).toBe("pre-roll");
    expect(agreed.num_episodes).toBe(3);
    expect(agreed.flight_start).toBe("2026-05-01");
    expect(agreed.flight_end).toBe("2026-05-31");
    expect(agreed.cpm_rate).toBe(25.5);
    expect(agreed.agreed_cpm).toBe(25.5);
  });
});
