import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MemoryAdmin } from "@/lib/api/memory-admin";
import type { DomainAdmin } from "@/app/api/v1/test-admin";

const bridge = vi.hoisted(() => ({
  keys: null as MemoryAdmin | null,
  data: null as DomainAdmin | null,
  actions: null as ReturnType<typeof createActionAdmin> | null,
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === "api_keys" || table === "profiles") return bridge.keys!.from(table);
      if (table === "api_write_actions") return bridge.actions!.from();
      return bridge.data!.from(table);
    },
    rpc: (name: string, args: { p_key_id: string; p_window_start: string }) => bridge.keys!.rpc(name, args),
  },
}));

vi.mock("@/lib/data/event-log", () => ({
  recordEvent: vi.fn(async () => undefined),
}));

import { createMemoryAdmin } from "@/lib/api/memory-admin";
import { createDomainAdmin } from "@/app/api/v1/test-admin";
import { createKey } from "@/lib/api/keys";
import {
  BRIEF_V2_FIELDS,
  CAMPAIGN_FIELDS,
  CONTACT_FIELDS,
  DEAL_FIELDS,
  DEMOGRAPHIC_FIELDS,
  FLIGHT_FIELDS,
  PLAN_FIELDS,
  PLAN_LINE_FIELDS,
  PRODUCT_FIELDS,
  RATE_FIELDS,
  SCORE_FIELDS,
  SHOW_FIELDS,
} from "@/lib/api/v1/serializers";
import { callTool, listTools, type ToolContext } from "@/lib/mcp/tools";

const BRAND = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const SHOW_PUBLIC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const SHOW_OWNED = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const CAMP = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const CAMP_OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb8";
const DEAL = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const DEAL_OTHER = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
const PATTERN = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
const SCORE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1";

const SECRET_KEY = /stripe|payment|payout|fee|card|setup_intent|envelope/i;
const ACTION_FIELDS = [
  "id",
  "kind",
  "status",
  "idempotency_key",
  "payload",
  "created_at",
  "decided_at",
  "decided_by",
];

function createActionAdmin() {
  const rows: Record<string, unknown>[] = [];
  const mutations: { table: string; op: string }[] = [];
  let tick = Date.parse("2026-10-21T12:00:00.000Z");

  function from() {
    const state = {
      op: "select" as "select" | "insert" | "update" | "delete",
      filters: [] as { column: string; value: unknown }[],
      columns: null as string | null,
      insertRow: null as Record<string, unknown> | null,
      patch: null as Record<string, unknown> | null,
      orders: [] as { column: string; ascending: boolean }[],
      max: null as number | null,
    };

    function project(row: Record<string, unknown>): Record<string, unknown> {
      if (!state.columns || state.columns.trim() === "*") return { ...row };
      const out: Record<string, unknown> = {};
      for (const column of state.columns.split(",").map((part) => part.trim())) {
        out[column] = row[column];
      }
      return out;
    }

    function matched(): Record<string, unknown>[] {
      return rows.filter((row) => state.filters.every((filter) => row[filter.column] === filter.value));
    }

    function execute(): { data: Record<string, unknown>[] | null; error: { code: string; message: string } | null } {
      if (state.op === "insert") {
        mutations.push({ table: "api_write_actions", op: "insert" });
        tick += 1000;
        const created: Record<string, unknown> = {
          decided_by: null,
          decided_at: null,
          status: "pending",
          ...(state.insertRow ?? {}),
          id: randomUUID(),
          created_at: new Date(tick).toISOString(),
        };
        rows.push(created);
        return { data: [project(created)], error: null };
      }
      if (state.op === "update") {
        mutations.push({ table: "api_write_actions", op: "update" });
        for (const row of matched()) Object.assign(row, state.patch);
      }
      if (state.op === "delete") {
        mutations.push({ table: "api_write_actions", op: "delete" });
      }
      let list = matched();
      if (state.orders.length > 0) {
        list = [...list].sort((left, right) => {
          for (const order of state.orders) {
            const a = left[order.column] == null ? "" : String(left[order.column]);
            const b = right[order.column] == null ? "" : String(right[order.column]);
            if (a === b) continue;
            const cmp = a < b ? -1 : 1;
            return order.ascending ? cmp : -cmp;
          }
          return 0;
        });
      }
      if (state.max != null) list = list.slice(0, state.max);
      return { data: list.map(project), error: null };
    }

    const builder = {
      select(columns?: string) {
        state.columns = columns ?? "*";
        return builder;
      },
      insert(row: Record<string, unknown>) {
        state.op = "insert";
        state.insertRow = row;
        return builder;
      },
      update(patch: Record<string, unknown>) {
        state.op = "update";
        state.patch = patch;
        return builder;
      },
      delete() {
        state.op = "delete";
        return builder;
      },
      eq(column: string, value: unknown) {
        state.filters.push({ column, value });
        return builder;
      },
      or() {
        return builder;
      },
      order(column: string, options?: { ascending?: boolean }) {
        state.orders.push({ column, ascending: options?.ascending !== false });
        return builder;
      },
      limit(count: number) {
        state.max = count;
        return builder;
      },
      maybeSingle() {
        const result = execute();
        return Promise.resolve({ data: result.data?.[0] ?? null, error: result.error });
      },
      single() {
        const result = execute();
        if (result.data?.length !== 1) {
          return Promise.resolve({ data: null, error: { code: "PGRST116", message: "expected one" } });
        }
        return Promise.resolve({ data: result.data[0], error: null });
      },
      then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
        try {
          return Promise.resolve(onFulfilled(execute()));
        } catch (err) {
          if (onRejected) return Promise.resolve(onRejected(err));
          return Promise.reject(err);
        }
      },
    };
    return builder;
  }

  return { rows, mutations, from };
}

function keysOf(value: unknown): string[] {
  const found: string[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (node && typeof node === "object") {
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
        found.push(key);
        walk(child);
      }
    }
  };
  walk(value);
  return found;
}

function expectKeys(value: unknown, allow: readonly string[]) {
  expect(Object.keys(value as object).sort()).toEqual([...allow].sort());
}

function expectClean(value: unknown) {
  for (const key of keysOf(value)) {
    expect(key).not.toMatch(SECRET_KEY);
  }
}

async function dataContext(): Promise<ToolContext> {
  bridge.keys!.profiles.push({ id: BRAND });
  const created = await createKey({
    brandId: BRAND,
    scopes: ["read", "write:campaigns", "write:outreach"],
  });
  return { brandId: BRAND, keyId: created.id, scopes: created.scopes };
}

beforeEach(() => {
  bridge.keys = createMemoryAdmin();
  bridge.data = createDomainAdmin();
  bridge.actions = createActionAdmin();
  bridge.data.tables.shows.push(
    {
      id: SHOW_PUBLIC,
      name: "Public",
      platform: "podcast",
      categories: ["business"],
      audience_size: 5000,
      is_discoverable: true,
      contact_email: "hidden-contact@example.com",
      rate_card: { midroll_cpm: 4242 },
      created_at: "2026-03-03T00:00:00.000Z",
      stripe_account_id: "acct_secret",
    },
    {
      id: SHOW_OWNED,
      name: "Owned private",
      slug: "owned",
      platform: "podcast",
      categories: ["business"],
      audience_size: 8000,
      description: "A private show",
      image_url: "https://cdn.example/owned.png",
      network: "Indie",
      tags: ["home"],
      demographics: { male: 40, us: 70 },
      audience_interests: ["wellness"],
      audience_purchase_power: 3,
      rate_card: { midroll_cpm: 25, preroll_cpm: 15 },
      price_type: "cpm",
      min_buy: 1,
      ad_formats: ["host_read"],
      episode_cadence: "weekly",
      avg_episode_length_min: 45,
      current_sponsors: ["Acme"],
      past_sponsors: [],
      apple_id: "apple",
      spotify_id: "spotify",
      youtube_channel_id: "UCowned",
      rss_url: "https://rss.example/owned",
      available_slots: 2,
      next_available_date: "2026-05-01",
      is_discoverable: false,
      contact_name: "Ada",
      contact_email: "ada@owned.example",
      contact_method: "email",
      data_sources: [],
      created_at: "2026-03-02T00:00:00.000Z",
    }
  );
  bridge.data.tables.campaigns.push(
    {
      id: CAMP,
      user_id: BRAND,
      name: "Spring test",
      status: "draft",
      budget_total: 25000,
      platforms: ["podcast"],
      brief: {
        version: 2,
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
        customer_text: "Buyers",
        goals: ["test_channel"],
        goals_context: "Learn the channel",
        flight: { mode: "preset", preset: "next_30_days" },
        exclusions_text: "No competitors",
        submitted_at: "2026-03-01T00:00:00.000Z",
        stripe_customer: "cus_secret",
      },
      media_plan: {
        default_placement: "mid-roll",
        default_episodes: 3,
        spacing: "weekly",
        updated_at: "2026-03-01T00:00:00.000Z",
        stripe_price_id: "price_secret",
        line_items: [
          {
            podcast_id: SHOW_PUBLIC,
            placement: "mid-roll",
            num_episodes: 3,
            addon_surface_ids: [],
            contact_email: "plan@example.com",
          },
        ],
      },
      test_spot_count: 3,
      test_placement: "mid-roll",
      created_at: "2026-03-01T00:00:00.000Z",
      updated_at: "2026-03-01T00:00:00.000Z",
      setup_intent_id: "seti_secret",
    },
    {
      id: CAMP_OTHER,
      user_id: OTHER,
      name: "Theirs",
      status: "draft",
      budget_total: 9000,
      platforms: ["podcast"],
      brief: {},
      created_at: "2026-03-02T00:00:00.000Z",
      updated_at: "2026-03-02T00:00:00.000Z",
    }
  );
  bridge.data.tables.deals.push(
    {
      id: DEAL,
      campaign_id: CAMP,
      show_id: SHOW_OWNED,
      brand_id: BRAND,
      status: "planning",
      placement: "mid-roll",
      ad_format: "host_read",
      num_episodes: 3,
      flight_start: "2026-04-01",
      flight_end: "2026-04-30",
      price_type: "cpm",
      cpm_rate: 25,
      gross_cpm: 25,
      gross_per_episode: 500,
      total_gross: 1500,
      agreed_cpm: 25,
      guaranteed_downloads: 10000,
      created_at: "2026-03-04T00:00:00.000Z",
      setup_intent_id: "seti_secret",
      stripe_payment_intent_id: "pi_secret",
    },
    {
      id: DEAL_OTHER,
      campaign_id: CAMP_OTHER,
      show_id: SHOW_PUBLIC,
      brand_id: OTHER,
      status: "planning",
      created_at: "2026-03-05T00:00:00.000Z",
      notes: "other brand note",
    }
  );
  bridge.data.tables.campaign_patterns.push({
    id: PATTERN,
    campaign_id: CAMP,
    created_at: "2026-03-02T00:00:00.000Z",
  });
  bridge.data.tables.conviction_scores.push({
    id: SCORE,
    campaign_pattern_id: PATTERN,
    show_id: SHOW_OWNED,
    ring_hypothesis_id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd3",
    audience_fit_score: 80,
    topical_relevance_score: 70,
    purchase_power_score: 60,
    composite_score: 75,
    conviction_band: "high",
    reasoning: "Audience buys home goods.",
    tier: "conviction",
    created_at: "2026-03-03T00:00:00.000Z",
    platform_fee: 10,
  });
});

describe("callTool", () => {
  it("returns serializer allowlists and drops payment fields", async () => {
    const ctx = await dataContext();
    const shows = await callTool(ctx, "list_shows", { limit: 50 });
    expect(shows.isError).toBe(false);
    expect(shows.content[0].text).toBe(JSON.stringify(shows.structuredContent));
    const showPage = shows.structuredContent as { data: Record<string, unknown>[]; next_cursor: string | null };
    expect(Object.keys(showPage).sort()).toEqual(["data", "next_cursor"]);
    const owned = showPage.data.find((row) => row.id === SHOW_OWNED);
    const pub = showPage.data.find((row) => row.id === SHOW_PUBLIC);
    expect(owned).toBeTruthy();
    expect(pub).toBeTruthy();
    expectKeys(owned, SHOW_FIELDS);
    expectKeys((owned as { demographics: unknown }).demographics, DEMOGRAPHIC_FIELDS);
    expectKeys((owned as { rates: unknown }).rates, RATE_FIELDS);
    expectKeys((owned as { contact: unknown }).contact, CONTACT_FIELDS);
    expect(Object.keys(pub as object)).not.toContain("contact");
    expect(Object.keys(pub as object)).not.toContain("rates");
    expect(JSON.stringify(pub)).not.toContain("hidden-contact@example.com");
    expect(JSON.stringify(pub)).not.toContain("4242");

    const show = await callTool(ctx, "get_show", { id: SHOW_OWNED });
    expectKeys((show.structuredContent as { data: unknown }).data, SHOW_FIELDS);

    const campaigns = await callTool(ctx, "list_campaigns", {});
    const campaignPage = campaigns.structuredContent as { data: Record<string, unknown>[] };
    expectKeys(campaignPage.data[0], CAMPAIGN_FIELDS);
    const brief = campaignPage.data[0].brief as Record<string, unknown>;
    expectKeys(brief, BRIEF_V2_FIELDS);
    expectKeys(brief.product, PRODUCT_FIELDS);
    expectKeys(brief.flight, FLIGHT_FIELDS);

    const one = await callTool(ctx, "get_campaign", { id: CAMP });
    expectKeys((one.structuredContent as { data: unknown }).data, CAMPAIGN_FIELDS);
    const missing = await callTool(ctx, "get_campaign", { id: CAMP_OTHER });
    expect(missing.isError).toBe(true);
    expect(missing.structuredContent).toEqual({ error: "Not found.", status: 404 });

    const scores = await callTool(ctx, "list_campaign_scores", { id: CAMP, limit: 10 });
    const scorePage = scores.structuredContent as { data: Record<string, unknown>[] };
    expect(scorePage.data).toHaveLength(1);
    expectKeys(scorePage.data[0], SCORE_FIELDS);

    const plan = await callTool(ctx, "get_campaign_plan", { id: CAMP });
    const planBody = (plan.structuredContent as { data: { line_items: Record<string, unknown>[] } }).data;
    expectKeys(planBody, PLAN_FIELDS);
    expectKeys(planBody.line_items[0], PLAN_LINE_FIELDS);
    expect(JSON.stringify(planBody)).not.toContain("plan@example.com");
    expect(JSON.stringify(planBody)).not.toContain("price_secret");

    const deals = await callTool(ctx, "list_deals", {});
    const dealPage = deals.structuredContent as { data: Record<string, unknown>[] };
    expect(dealPage.data).toHaveLength(1);
    expectKeys(dealPage.data[0], DEAL_FIELDS);
    const deal = await callTool(ctx, "get_deal", { id: DEAL });
    expectKeys((deal.structuredContent as { data: unknown }).data, DEAL_FIELDS);
    const foreignDeal = await callTool(ctx, "get_deal", { id: DEAL_OTHER });
    expect(foreignDeal.structuredContent).toEqual({ error: "Not found.", status: 404 });

    const proposed = await callTool(ctx, "propose_campaign", {
      idempotency_key: "tool-campaign",
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
      customer_text: "People who want a sauna at home.",
      goals: ["test_channel"],
      budget_total: 25000,
      flight: { mode: "preset", preset: "next_30_days" },
    });
    expect(proposed.isError).toBe(false);
    expect(Object.keys(proposed.structuredContent as object).sort()).toEqual([
      "action_id",
      "replayed",
      "status",
    ]);
    const actionId = (proposed.structuredContent as { action_id: string }).action_id;
    const action = await callTool(ctx, "get_action", { id: actionId });
    expectKeys((action.structuredContent as { data: unknown }).data, ACTION_FIELDS);
    const actions = await callTool(ctx, "list_actions", {});
    const actionPage = actions.structuredContent as { data: Record<string, unknown>[] };
    expectKeys(actionPage.data[0], ACTION_FIELDS);

    for (const result of [shows, campaigns, scores, plan, deals, deal, action, actions, proposed]) {
      expectClean(result.structuredContent);
    }
    expect(bridge.actions!.mutations).toEqual([{ table: "api_write_actions", op: "insert" }]);
    expect(bridge.data!.tables.campaigns).toHaveLength(2);
    expect(bridge.data!.tables.deals).toHaveLength(2);
  });

  it("filters tools/list by scope and does not run a tool the key cannot call", async () => {
    expect(listTools(["read"]).map((tool) => tool.name)).not.toContain("propose_outreach");
    expect(listTools(["write:campaigns"]).map((tool) => tool.name)).toEqual(["propose_campaign"]);
    const ctx: ToolContext = {
      brandId: BRAND,
      keyId: "33333333-3333-4333-8333-333333333333",
      scopes: ["read"],
    };
    const denied = await callTool(ctx, "propose_outreach", { brand_id: BRAND });
    expect(denied.isError).toBe(true);
    expect(denied.structuredContent).toEqual({
      error: "API key lacks the required scope.",
      status: 403,
    });
    expect(bridge.actions!.rows).toHaveLength(0);
  });
});
