import { beforeEach, describe, expect, it, vi } from "vitest";

const USER = "11111111-1111-4111-8111-111111111111";
const CAMPAIGN = "22222222-2222-4222-8222-222222222222";
const LISTED = "33333333-3333-4333-8333-333333333333";
const HIDDEN = "66666666-6666-4666-8666-666666666666";

const getAuthenticatedUser = vi.fn();
const getBrandProfileByUserId = vi.fn();
const getCampaignById = vi.fn();
const createOutreach = vi.fn();
const sendEmail = vi.fn(async (...args: unknown[]) => {
  void args;
  return { ok: true, id: "msg" };
});

const tables: Record<string, Array<Record<string, unknown>>> = {};

function matches(
  row: Record<string, unknown>,
  filters: Array<{ op: "eq" | "in"; column: string; value: unknown }>
) {
  return filters.every((filter) => {
    if (filter.op === "eq") return row[filter.column] === filter.value;
    return (filter.value as unknown[]).includes(row[filter.column]);
  });
}

function from(table: string) {
  const filters: Array<{ op: "eq" | "in"; column: string; value: unknown }> = [];
  const rows = () => (tables[table] ?? []).filter((row) => matches(row, filters));
  const api = {
    select() {
      return api;
    },
    eq(column: string, value: unknown) {
      filters.push({ op: "eq", column, value });
      return api;
    },
    in(column: string, value: unknown[]) {
      filters.push({ op: "in", column, value });
      return api;
    },
    update() {
      return api;
    },
    insert() {
      return { error: { code: "42P01" } };
    },
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    single: async () => ({
      data: { id: "o1", token: "", sent_to_email: "host@example.test" },
      error: null,
    }),
    then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
      return Promise.resolve({ data: rows(), error: null }).then(resolve, reject);
    },
  };
  return api;
}

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: (...args: unknown[]) => getAuthenticatedUser(...args),
  getBrandProfileByUserId: (...args: unknown[]) => getBrandProfileByUserId(...args),
  getCampaignById: (...args: unknown[]) => getCampaignById(...args),
  createOutreach: (...args: unknown[]) => createOutreach(...args),
}));
vi.mock("@/lib/email/send", () => ({
  sendEmail: (...args: unknown[]) => sendEmail(...args),
}));
vi.mock("@/lib/security/rate-limit", () => ({
  enforceOutreachSend: async () => null,
}));
vi.mock("@/lib/data/event-log", () => ({
  recordEvent: async () => undefined,
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: (table: string) => from(table) },
}));
vi.mock("@/lib/relay/threads", () => ({
  createRelayThread: async () => null,
}));
vi.mock("@/lib/relay/crm", () => ({
  addShowToBrandCrmOnOutreach: async () => ({ added: false, reason: "no_crm_access" }),
}));

import { POST } from "./route";

function post(showId: string) {
  return new Request("http://x/api/outreach", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      campaign_id: CAMPAIGN,
      show: {
        show_id: showId,
        show_name: "Daily",
        contact_email: "attacker@example.test",
      },
      proposed: {
        cpm: 25,
        episode_count: 3,
        placement: "mid-roll",
        flight_start: "2026-12-01",
        flight_end: "2026-12-31",
      },
      pitch_body: "We would like to run a three episode test on this show in December.",
    }),
  });
}

describe("POST /api/outreach catalog guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthenticatedUser.mockResolvedValue({ id: USER });
    getBrandProfileByUserId.mockResolvedValue({ id: "bp1", user_id: USER, brand_identity: "Aurora" });
    getCampaignById.mockResolvedValue({ id: CAMPAIGN, user_id: USER, name: "Spring" });
    createOutreach.mockResolvedValue({ id: "o1" });
    tables.campaigns = [
      {
        id: CAMPAIGN,
        user_id: USER,
        selected_show_ids: [LISTED],
        scored_shows: [],
        recommendations: [],
        youtube_recommendations: [],
        expansion_opportunities: [],
      },
    ];
    tables.shows = [
      { id: LISTED, contact_email: "host@example.test", is_discoverable: true },
      { id: HIDDEN, contact_email: "hidden@example.test", is_discoverable: false },
    ];
  });

  it("does not send when the catalog show is not on the campaign", async () => {
    const res = await POST(post(HIDDEN) as never);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Campaign not found");
    expect(JSON.stringify(body)).not.toContain("hidden@example.test");
    expect(sendEmail).not.toHaveBeenCalled();
    expect(createOutreach).not.toHaveBeenCalled();
  });

  it("sends when the catalog show is on the campaign", async () => {
    const res = await POST(post(LISTED) as never);
    expect(res.status).toBe(200);
    expect(sendEmail).toHaveBeenCalledOnce();
    const sent = sendEmail.mock.calls[0]?.[0] as { to?: string } | undefined;
    expect(sent?.to).toBe("host@example.test");
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain("host@example.test");
    expect(JSON.stringify(body)).not.toContain("attacker@example.test");
  });
});
