import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { MemoryAdmin } from "@/lib/api/memory-admin";
import type { DomainAdmin } from "./test-admin";

const bridge = vi.hoisted(() => ({
  keys: null as MemoryAdmin | null,
  data: null as DomainAdmin | null,
  recordEvent: vi.fn(async (_input: unknown) => undefined),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: null } })) },
  })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === "api_keys") return bridge.keys!.from(table);
      return bridge.data!.from(table);
    },
    rpc: (name: string, args: { p_key_id: string; p_window_start: string }) =>
      bridge.keys!.rpc(name, args),
  },
}));

vi.mock("@/lib/data/event-log", () => ({
  recordEvent: (input: unknown) => bridge.recordEvent(input),
}));

import { createMemoryAdmin } from "@/lib/api/memory-admin";
import { createDomainAdmin } from "./test-admin";
import { createKey } from "@/lib/api/keys";
import {
  API_RATE_LIMIT_PER_MINUTE,
  _setApiRateClockForTests,
} from "@/lib/api/rate-limit";
import { DEAL_FIELDS, SHOW_FIELDS } from "@/lib/api/v1/serializers";
import { GET as listShows } from "./shows/route";
import { GET as getShow } from "./shows/[id]/route";
import { GET as listCampaigns } from "./campaigns/route";
import { GET as getCampaign } from "./campaigns/[id]/route";
import { GET as listScores } from "./campaigns/[id]/scores/route";
import { GET as getPlan } from "./campaigns/[id]/plan/route";
import { GET as listDeals } from "./deals/route";
import { GET as getDeal } from "./deals/[id]/route";
import { GET as openApiRoute } from "./openapi.json/route";

const BRAND = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const PROFILE = "33333333-3333-4333-8333-333333333333";
const OTHER_PROFILE = "44444444-4444-4444-8444-444444444444";
const HOST = "ffffffff-ffff-4fff-8fff-fffffffffff1";
const SHOW_PROFILE = "99999999-9999-4999-8999-999999999991";
const SHOW_PUBLIC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const SHOW_OWNED = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const SHOW_HIDDEN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const SHOW_HOST = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4";
const CAMP = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const CAMP_OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb8";
const DEAL_BRAND = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const DEAL_OTHER = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
const DEAL_PROFILE = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3";
const DEAL_TIED = "cccccccc-cccc-4ccc-8ccc-ccccccccccc4";
const PATTERN = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
const SCORE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1";
const FIXED_NOW = new Date("2026-10-21T23:18:10.000Z");

interface ShowJson {
  id: string;
  verified: boolean;
}

function call<Route>(
  handler: (req: Request, route: Route) => Promise<Response>,
  path: string,
  token?: string,
  id?: string
) {
  const headers = new Headers();
  if (token) headers.set("authorization", `Bearer ${token}`);
  const req = new NextRequest(`https://www.taylslate.com${path}`, { headers });
  const route = (id === undefined ? undefined : { params: Promise.resolve({ id }) }) as Route;
  return handler(req, route);
}

function box<Route>(
  handler: (req: Request, route: Route) => Promise<Response>,
  path: string,
  id?: string
) {
  return {
    run: (token?: string) => call(handler, path, token, id),
  };
}

async function readKey(scopes: string[] = ["read"]) {
  const created = await createKey({ brandId: BRAND, scopes });
  return created.secret;
}

function seqId(prefix: string, n: number): string {
  return `${prefix}-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
}

beforeEach(() => {
  bridge.keys = createMemoryAdmin();
  bridge.data = createDomainAdmin();
  bridge.recordEvent.mockClear();
  _setApiRateClockForTests(() => FIXED_NOW);
});

afterEach(() => {
  _setApiRateClockForTests(null);
});

describe("GET /api/v1 auth", () => {
  it("returns 401 for a missing key on every read route", async () => {
    const routes = [
      box(listShows, "/api/v1/shows"),
      box(getShow, "/api/v1/shows/" + SHOW_PUBLIC, SHOW_PUBLIC),
      box(listCampaigns, "/api/v1/campaigns"),
      box(getCampaign, "/api/v1/campaigns/" + CAMP, CAMP),
      box(listScores, "/api/v1/campaigns/" + CAMP + "/scores", CAMP),
      box(getPlan, "/api/v1/campaigns/" + CAMP + "/plan", CAMP),
      box(listDeals, "/api/v1/deals"),
      box(getDeal, "/api/v1/deals/" + DEAL_BRAND, DEAL_BRAND),
    ];
    for (const route of routes) {
      const res = await route.run();
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "Missing or invalid API key." });
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("returns 403 when the key lacks read", async () => {
    const secret = await readKey(["write:campaigns"]);
    const res = await call(listShows, "/api/v1/shows", secret);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "API key lacks the required scope." });
    expect(bridge.keys!.windows).toHaveLength(1);
  });

  it("returns 429 with Retry-After once the minute window is full", async () => {
    const secret = await readKey();
    for (let n = 0; n < API_RATE_LIMIT_PER_MINUTE; n += 1) {
      const ok = await call(listDeals, "/api/v1/deals", secret);
      expect(ok.status).toBe(200);
    }
    const blocked = await call(listDeals, "/api/v1/deals", secret);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("50");
    expect(await blocked.json()).toEqual({ error: "Rate limit exceeded." });
  });

  it("returns a generic 500 when a read fails", async () => {
    const secret = await readKey();
    bridge.data!.failNext("database secret leaked");
    const res = await call(listShows, "/api/v1/shows", secret);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "API request failed." });
    expect(JSON.stringify(body)).not.toContain("secret");
  });
});

describe("brand isolation", () => {
  it("hides another brand's campaign and pages this brand's rows", async () => {
    const secret = await readKey();
    bridge.data!.tables.campaigns.push(
      {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3",
        user_id: BRAND,
        name: "Newest",
        status: "planned",
        budget_total: 1000,
        platforms: ["podcast"],
        brief: { brand_url: "https://brand.example" },
        created_at: "2026-01-03T00:00:00.000Z",
        updated_at: "2026-01-03T00:00:00.000Z",
        user_email: "brand@example.com",
      },
      {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
        user_id: BRAND,
        name: "Tie high",
        status: "draft",
        budget_total: 500,
        platforms: ["podcast"],
        brief: {},
        created_at: "2026-01-02T00:00:00.000Z",
        updated_at: "2026-01-02T00:00:00.000Z",
      },
      {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
        user_id: BRAND,
        name: "Tie low",
        status: "draft",
        budget_total: 500,
        platforms: ["podcast"],
        brief: {},
        created_at: "2026-01-02T00:00:00.000Z",
        updated_at: "2026-01-02T00:00:00.000Z",
      },
      {
        id: CAMP_OTHER,
        user_id: OTHER,
        name: "Foreign",
        status: "active",
        budget_total: 9000,
        platforms: ["podcast"],
        brief: { brand_url: "https://other.example" },
        created_at: "2026-01-04T00:00:00.000Z",
        updated_at: "2026-01-04T00:00:00.000Z",
      }
    );

    const first = await call(listCampaigns, "/api/v1/campaigns?limit=2", secret);
    expect(first.status).toBe(200);
    const page1 = await first.json();
    expect(page1.data.map((row: { id: string }) => row.id)).toEqual([
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3",
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
    ]);
    expect(page1.next_cursor).toEqual(expect.any(String));
    expect(JSON.stringify(page1)).not.toContain("other.example");
    expect(JSON.stringify(page1)).not.toContain(OTHER);

    const second = await call(
      listCampaigns,
      `/api/v1/campaigns?limit=2&cursor=${encodeURIComponent(page1.next_cursor)}`,
      secret
    );
    const page2 = await second.json();
    expect(page2.data.map((row: { id: string }) => row.id)).toEqual([
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
    ]);
    expect(page2.next_cursor).toBeNull();

    const missing = await call(
      getCampaign,
      "/api/v1/campaigns/" + CAMP_OTHER,
      secret,
      CAMP_OTHER
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "Not found." });
    expect(missing.headers.get("cache-control")).toBe("no-store");

    const badCursor = await call(listCampaigns, "/api/v1/campaigns?cursor=nope", secret);
    expect(badCursor.status).toBe(400);
    expect(await badCursor.json()).toEqual({ error: "Invalid cursor." });

    const badLimit = await call(listCampaigns, "/api/v1/campaigns?limit=0", secret);
    expect(badLimit.status).toBe(400);
    expect(await badLimit.json()).toEqual({ error: "Invalid limit." });
  });

  it("clamps limit to 100 and defaults to 25", async () => {
    const secret = await readKey();
    for (let n = 1; n <= 101; n += 1) {
      bridge.data!.tables.campaigns.push({
        id: seqId("c1000000", n),
        user_id: BRAND,
        name: `Campaign ${n}`,
        status: "draft",
        budget_total: n,
        platforms: ["podcast"],
        brief: {},
        created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString(),
        updated_at: new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString(),
      });
    }

    const clamped = await call(listCampaigns, "/api/v1/campaigns?limit=5000", secret);
    const wide = await clamped.json();
    expect(wide.data).toHaveLength(100);
    expect(wide.next_cursor).toEqual(expect.any(String));
    const rest = await call(
      listCampaigns,
      `/api/v1/campaigns?limit=5000&cursor=${encodeURIComponent(wide.next_cursor)}`,
      secret
    );
    const tail = await rest.json();
    expect(tail.data).toHaveLength(1);
    expect(tail.next_cursor).toBeNull();
    const seen = new Set<string>();
    for (const row of wide.data) seen.add(row.id);
    for (const row of tail.data) {
      expect(seen.has(row.id)).toBe(false);
    }

    bridge.data!.tables.campaigns.length = 0;
    for (let n = 1; n <= 30; n += 1) {
      bridge.data!.tables.campaigns.push({
        id: seqId("c2000000", n),
        user_id: BRAND,
        name: `Default ${n}`,
        status: "draft",
        budget_total: 1,
        platforms: ["podcast"],
        brief: {},
        created_at: new Date(Date.UTC(2026, 1, 1, 0, 0, n)).toISOString(),
        updated_at: new Date(Date.UTC(2026, 1, 1, 0, 0, n)).toISOString(),
      });
    }
    const defaults = await call(listCampaigns, "/api/v1/campaigns", secret);
    const page = await defaults.json();
    expect(page.data).toHaveLength(25);
    expect(page.next_cursor).toEqual(expect.any(String));
  });

  it("returns discoverable shows and this brand's private shows only", async () => {
    const secret = await readKey();
    bridge.data!.tables.brand_profiles.push({ id: PROFILE, user_id: BRAND });
    bridge.data!.tables.profiles.push({ id: HOST, email: "host@example.com" });
    bridge.data!.tables.show_profiles.push({ id: SHOW_PROFILE, user_id: HOST });
    bridge.data!.tables.shows.push(
      {
        id: SHOW_PUBLIC,
        name: "Public",
        slug: "public",
        platform: "podcast",
        categories: ["business"],
        audience_size: 5000,
        is_discoverable: true,
        is_verified: true,
        contact_email: "secret@example.com",
        agent_id: OTHER,
        created_at: "2026-03-03T00:00:00.000Z",
        rate_card: { midroll_cpm: 20, contact_email: "rate@example.com" },
      },
      {
        id: SHOW_OWNED,
        name: "Owned private",
        slug: "owned-private",
        platform: "podcast",
        categories: ["business"],
        audience_size: 800,
        is_discoverable: false,
        is_verified: false,
        contact_email: "owned@example.com",
        created_at: "2026-03-01T00:00:00.000Z",
      },
      {
        id: SHOW_HIDDEN,
        name: "Hidden",
        slug: "hidden",
        platform: "podcast",
        categories: [],
        audience_size: 100,
        is_discoverable: false,
        contact_email: "hidden@example.com",
        created_at: "2026-03-04T00:00:00.000Z",
      },
      {
        id: SHOW_HOST,
        name: "Host tied",
        slug: "host-tied",
        platform: "podcast",
        categories: ["culture"],
        audience_size: 2000,
        is_discoverable: true,
        contact_email: "host@example.com",
        data_sources: ["show_owner"],
        created_at: "2026-03-02T00:00:00.000Z",
      }
    );
    bridge.data!.tables.deals.push({
      id: DEAL_TIED,
      brand_id: BRAND,
      brand_profile_id: PROFILE,
      show_id: SHOW_OWNED,
      show_profile_id: SHOW_PROFILE,
      created_at: "2026-03-01T00:00:00.000Z",
      status: "planning",
    });

    const listed = await call(listShows, "/api/v1/shows?limit=2", secret);
    const page1 = (await listed.json()) as {
      data: ShowJson[];
      next_cursor: string | null;
    };
    const next = await call(
      listShows,
      `/api/v1/shows?limit=2&cursor=${encodeURIComponent(page1.next_cursor ?? "")}`,
      secret
    );
    const page2 = (await next.json()) as {
      data: ShowJson[];
      next_cursor: string | null;
    };
    const rows = page1.data.concat(page2.data);
    expect(rows.map((row) => row.id)).toEqual([SHOW_PUBLIC, SHOW_HOST, SHOW_OWNED]);
    expect(page2.next_cursor).toBeNull();

    const byId = new Map(rows.map((row) => [row.id, row]));
    const publicShow = byId.get(SHOW_PUBLIC);
    const hostShow = byId.get(SHOW_HOST);
    const ownedShow = byId.get(SHOW_OWNED);
    if (!publicShow || !hostShow || !ownedShow) throw new Error("missing show page row");
    expect(publicShow.verified).toBe(false);
    expect(hostShow.verified).toBe(true);
    expect(ownedShow.verified).toBe(true);
    expect(Object.keys(publicShow).sort()).toEqual([...SHOW_FIELDS].sort());
    const body = JSON.stringify(rows);
    expect(body).not.toContain("secret@example.com");
    expect(body).not.toContain("hidden@example.com");
    expect(body).not.toContain("rate@example.com");
    expect(body).not.toContain(OTHER);

    const owned = await call(getShow, "/api/v1/shows/" + SHOW_OWNED, secret, SHOW_OWNED);
    expect(owned.status).toBe(200);
    expect((await owned.json()).data.verified).toBe(true);

    const hidden = await call(getShow, "/api/v1/shows/" + SHOW_HIDDEN, secret, SHOW_HIDDEN);
    expect(hidden.status).toBe(404);
    expect(await hidden.json()).toEqual({ error: "Not found." });

    const junk = await call(getShow, "/api/v1/shows/not-a-uuid", secret, "not-a-uuid");
    expect(junk.status).toBe(404);
  });

  it("includes legacy brand_id deals and Wave 12 profile deals, and hides the rest", async () => {
    const secret = await readKey();
    bridge.data!.tables.brand_profiles.push(
      { id: PROFILE, user_id: BRAND },
      { id: OTHER_PROFILE, user_id: OTHER }
    );
    const poison = {
      net_per_episode: 10,
      total_net: 30,
      stripe_payment_intent_id: "pi_secret",
      payment_method_id: "pm_secret",
      setup_intent_id: "seti_secret",
      setup_intent_client_secret: "seti_secret_secret",
      docusign_envelope_id: "env_secret",
      card_on_file_at: "2026-04-02T00:00:00.000Z",
      platform_fee_percentage: 6,
    };
    bridge.data!.tables.deals.push(
      {
        id: DEAL_BRAND,
        brand_id: BRAND,
        show_id: SHOW_PUBLIC,
        campaign_id: CAMP,
        status: "live",
        placement: "mid-roll",
        ad_format: "host_read",
        num_episodes: 3,
        flight_start: "2026-04-01",
        flight_end: "2026-04-30",
        price_type: "cpm",
        cpm_rate: 28,
        gross_cpm: 28,
        gross_per_episode: 280,
        total_gross: 840,
        agreed_cpm: 28,
        guaranteed_downloads: 8000,
        created_at: "2026-04-03T00:00:00.000Z",
        ...poison,
        notes: "secret note",
      },
      {
        id: DEAL_PROFILE,
        brand_id: null,
        brand_profile_id: PROFILE,
        show_id: SHOW_OWNED,
        campaign_id: CAMP,
        status: "planning",
        placement: null,
        agreed_placement: "pre-roll",
        num_episodes: null,
        agreed_episode_count: 3,
        flight_start: null,
        agreed_flight_start: "2026-05-01",
        flight_end: null,
        agreed_flight_end: "2026-05-31",
        cpm_rate: null,
        agreed_cpm: 22,
        created_at: "2026-04-02T00:00:00.000Z",
        ...poison,
      },
      {
        id: DEAL_TIED,
        brand_id: OTHER,
        brand_profile_id: PROFILE,
        show_id: SHOW_HOST,
        status: "io_sent",
        placement: "post-roll",
        ad_format: "host_read",
        num_episodes: 1,
        flight_start: "2026-06-01",
        flight_end: "2026-06-30",
        price_type: "cpm",
        cpm_rate: 18,
        agreed_cpm: 18,
        created_at: "2026-04-01T00:00:00.000Z",
        ...poison,
      },
      {
        id: DEAL_OTHER,
        brand_id: OTHER,
        brand_profile_id: OTHER_PROFILE,
        show_id: SHOW_HIDDEN,
        status: "live",
        placement: "mid-roll",
        ad_format: "host_read",
        num_episodes: 4,
        flight_start: "2026-07-01",
        flight_end: "2026-07-31",
        price_type: "cpm",
        cpm_rate: 40,
        created_at: "2026-04-04T00:00:00.000Z",
        ...poison,
        notes: "other brand note",
      }
    );

    const listed = await call(listDeals, "/api/v1/deals?limit=10", secret);
    const page = await listed.json();
    expect(page.data.map((row: { id: string }) => row.id)).toEqual([
      DEAL_BRAND,
      DEAL_PROFILE,
      DEAL_TIED,
    ]);
    expect(Object.keys(page.data[0]).sort()).toEqual([...DEAL_FIELDS].sort());
    expect(page.data[1].placement).toBe("pre-roll");
    expect(page.data[1].cpm_rate).toBe(22);
    const body = JSON.stringify(page);
    expect(body).not.toContain("pi_secret");
    expect(body).not.toContain("seti_secret");
    expect(body).not.toContain("env_secret");
    expect(body).not.toContain("secret note");
    expect(body).not.toContain("other brand note");
    expect(body).not.toMatch(/stripe|payment|payout|fee|card|setup_intent|envelope/i);

    const hidden = await call(getDeal, "/api/v1/deals/" + DEAL_OTHER, secret, DEAL_OTHER);
    expect(hidden.status).toBe(404);
    expect(await hidden.json()).toEqual({ error: "Not found." });

    const visible = await call(getDeal, "/api/v1/deals/" + DEAL_BRAND, secret, DEAL_BRAND);
    expect(visible.status).toBe(200);
    expect((await visible.json()).data.id).toBe(DEAL_BRAND);

    const dealSelects = bridge.data!.selects.filter((columns) => columns.includes("agreed_cpm"));
    expect(dealSelects.length).toBeGreaterThan(0);
    for (const columns of dealSelects) {
      expect(columns).not.toContain("setup_intent");
      expect(columns).not.toContain("payment_method");
      expect(columns).not.toContain("docusign");
      expect(columns).not.toContain("net_per_episode");
      expect(columns).not.toContain("notes");
    }
  });

  it("scores and plan stay inside the brand's campaign", async () => {
    const secret = await readKey();
    bridge.data!.tables.campaigns.push(
      {
        id: CAMP,
        user_id: BRAND,
        name: "Owned",
        status: "planned",
        budget_total: 2000,
        platforms: ["podcast"],
        brief: { version: 2, customer_text: "Buyers" },
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
        created_at: "2026-03-01T00:00:00.000Z",
        updated_at: "2026-03-01T00:00:00.000Z",
      },
      {
        id: CAMP_OTHER,
        user_id: OTHER,
        name: "Theirs",
        status: "planned",
        budget_total: 9000,
        platforms: ["youtube"],
        brief: {},
        media_plan: { default_placement: "pre-roll", default_episodes: 1, spacing: "weekly", line_items: [], updated_at: "2026-03-01T00:00:00.000Z" },
        created_at: "2026-03-02T00:00:00.000Z",
        updated_at: "2026-03-02T00:00:00.000Z",
      }
    );
    bridge.data!.tables.campaign_patterns.push(
      {
        id: PATTERN,
        campaign_id: CAMP,
        created_at: "2026-03-02T00:00:00.000Z",
      },
      {
        id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd2",
        campaign_id: CAMP_OTHER,
        created_at: "2026-03-03T00:00:00.000Z",
      }
    );
    bridge.data!.tables.conviction_scores.push({
      id: SCORE,
      campaign_pattern_id: PATTERN,
      show_id: SHOW_PUBLIC,
      ring_hypothesis_id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd3",
      audience_fit_score: 81,
      topical_relevance_score: 70,
      purchase_power_score: 64,
      composite_score: 75,
      conviction_band: "high",
      reasoning: "Strong host fit",
      tier: "test",
      created_at: "2026-03-02T00:00:00.000Z",
      setup_intent_id: "seti_score",
    });

    const scores = await call(listScores, "/api/v1/campaigns/" + CAMP + "/scores", secret, CAMP);
    expect(scores.status).toBe(200);
    const scoreBody = await scores.json();
    expect(scoreBody.data).toHaveLength(1);
    expect(scoreBody.data[0].composite_score).toBe(75);
    expect(scoreBody.next_cursor).toBeNull();
    expect(JSON.stringify(scoreBody)).not.toContain("seti_score");

    const foreignScores = await call(
      listScores,
      "/api/v1/campaigns/" + CAMP_OTHER + "/scores",
      secret,
      CAMP_OTHER
    );
    expect(foreignScores.status).toBe(404);

    const plan = await call(getPlan, "/api/v1/campaigns/" + CAMP + "/plan", secret, CAMP);
    expect(plan.status).toBe(200);
    const planBody = await plan.json();
    expect(planBody.data.default_episodes).toBe(3);
    expect(planBody.data.line_items[0].podcast_id).toBe(SHOW_PUBLIC);
    expect(JSON.stringify(planBody)).not.toContain("plan@example.com");
    expect(JSON.stringify(planBody)).not.toContain("price_secret");

    const emptyPlanCampaign = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb9";
    bridge.data!.tables.campaigns.push({
      id: emptyPlanCampaign,
      user_id: BRAND,
      name: "No plan",
      status: "draft",
      budget_total: 1,
      platforms: ["podcast"],
      brief: {},
      media_plan: null,
      created_at: "2026-03-04T00:00:00.000Z",
      updated_at: "2026-03-04T00:00:00.000Z",
    });
    const empty = await call(
      getPlan,
      "/api/v1/campaigns/" + emptyPlanCampaign + "/plan",
      secret,
      emptyPlanCampaign
    );
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ data: null });

    const foreignPlan = await call(
      getPlan,
      "/api/v1/campaigns/" + CAMP_OTHER + "/plan",
      secret,
      CAMP_OTHER
    );
    expect(foreignPlan.status).toBe(404);
    expect(await foreignPlan.json()).toEqual({ error: "Not found." });
  });
});

describe("GET /api/v1/openapi.json", () => {
  it("returns the document without a key", async () => {
    const res = await openApiRoute();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.openapi).toBe("3.1.0");
    expect(body.paths["/api/v1/shows"].get).toBeTruthy();
    expect(bridge.keys!.keys).toHaveLength(0);
  });
});
