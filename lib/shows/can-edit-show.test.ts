import { beforeEach, describe, expect, it, vi } from "vitest";

const { from, ties } = vi.hoisted(() => ({
  from: vi.fn(),
  ties: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: (...args: unknown[]) => from(...args) },
}));

vi.mock("@/lib/shows/apply-geography", () => ({
  getVerifiedProfileTies: (...args: unknown[]) => ties(...args),
}));

import { canEditShow, isShowsAdmin, showWritePatch } from "./can-edit-show";

const USER = "11111111-1111-4111-8111-111111111111";
const SHOW = "22222222-2222-4222-8222-222222222222";
const PROFILE = "33333333-3333-4333-8333-333333333333";

interface Row {
  data: Record<string, unknown> | null;
}

function table(rows: Record<string, Row>) {
  from.mockImplementation((name: string) => {
    const filters: Record<string, unknown> = {};
    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        filters[column] = value;
        return builder;
      },
      maybeSingle: async () => {
        const row = rows[name];
        if (!row) return { data: null, error: null };
        if (name === "agent_show_relationships") {
          const rel = row.data;
          if (!rel) return { data: null, error: null };
          if (filters.agent_id !== rel.agent_id || filters.show_id !== rel.show_id) {
            return { data: null, error: null };
          }
          if (filters.status !== undefined && filters.status !== rel.status) {
            return { data: null, error: null };
          }
        }
        return { data: row.data, error: null };
      },
    };
    return builder;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  ties.mockResolvedValue([]);
  delete process.env.INTERNAL_ADMIN_EMAILS;
});

describe("canEditShow", () => {
  it("allows an internal admin and a profile role of admin", async () => {
    process.env.INTERNAL_ADMIN_EMAILS = "ops@taylslate.com";
    table({
      profiles: { data: { id: USER, email: "ops@taylslate.com", role: "brand" } },
    });
    expect(await canEditShow(USER, SHOW)).toBe(true);
    expect(await isShowsAdmin(USER)).toBe(true);

    table({
      profiles: { data: { id: USER, email: "other@taylslate.com", role: "admin" } },
    });
    expect(await canEditShow(USER, SHOW)).toBe(true);
  });

  it("allows an agent only when the roster link is approved", async () => {
    table({
      profiles: { data: { id: USER, email: "rep@taylslate.com", role: "agent" } },
      shows: { data: { id: SHOW, agent_id: USER, contact_email: "", data_sources: [] } },
      agent_show_relationships: {
        data: { id: "rel", agent_id: USER, show_id: SHOW, status: "approved" },
      },
    });
    expect(await canEditShow(USER, SHOW)).toBe(true);

    for (const status of ["pending", "rejected"]) {
      table({
        profiles: { data: { id: USER, email: "rep@taylslate.com", role: "agent" } },
        shows: { data: { id: SHOW, agent_id: USER, contact_email: "", data_sources: [] } },
        agent_show_relationships: {
          data: { id: "rel", agent_id: USER, show_id: SHOW, status },
        },
      });
      expect(await canEditShow(USER, SHOW)).toBe(false);
    }

    table({
      profiles: { data: { id: USER, email: "rep@taylslate.com", role: "agent" } },
      shows: { data: { id: SHOW, agent_id: USER, contact_email: "", data_sources: [] } },
    });
    expect(await canEditShow(USER, SHOW)).toBe(false);
  });

  it("refuses a brand, an unrelated agent, and an unrelated show user", async () => {
    table({
      profiles: { data: { id: USER, email: "brand@taylslate.com", role: "brand" } },
      shows: { data: { id: SHOW, agent_id: "other", contact_email: "host@show.test", data_sources: ["show_owner"] } },
    });
    expect(await canEditShow(USER, SHOW)).toBe(false);

    table({
      profiles: { data: { id: USER, email: "rep@taylslate.com", role: "agent" } },
      shows: { data: { id: SHOW, agent_id: "other", contact_email: "", data_sources: [] } },
      agent_show_relationships: {
        data: { id: "rel", agent_id: USER, show_id: SHOW, status: "pending" },
      },
    });
    expect(await canEditShow(USER, SHOW)).toBe(false);

    table({
      profiles: { data: { id: USER, email: "host@other.test", role: "show" } },
      shows: { data: { id: SHOW, agent_id: null, contact_email: "host@show.test", data_sources: ["show_owner"] } },
      show_profiles: { data: { id: PROFILE } },
    });
    ties.mockResolvedValue([]);
    expect(await canEditShow(USER, SHOW)).toBe(false);
    expect(ties).toHaveBeenCalledWith([
      {
        showId: SHOW,
        contactEmail: "host@show.test",
        dataSources: ["show_owner"],
      },
    ]);
  });

  it("allows a show user only through getVerifiedProfileTies", async () => {
    table({
      profiles: { data: { id: USER, email: "host@show.test", role: "show" } },
      shows: { data: { id: SHOW, agent_id: null, contact_email: "host@show.test", data_sources: ["show_owner"] } },
      show_profiles: { data: { id: PROFILE } },
    });
    ties.mockResolvedValue([{ showId: SHOW, profileId: PROFILE }]);
    expect(await canEditShow(USER, SHOW)).toBe(true);

    ties.mockResolvedValue([{ showId: SHOW, profileId: "someone-else" }]);
    expect(await canEditShow(USER, SHOW)).toBe(false);
  });
});

describe("showWritePatch", () => {
  it("keeps admin-only columns for an admin and drops them otherwise", () => {
    const body = {
      id: "x",
      created_at: "then",
      description: "updated",
      agent_id: USER,
      is_verified: true,
      is_claimed: true,
      podscan_id: "pod",
      is_discoverable: false,
    };
    expect(showWritePatch(body, false)).toEqual({ description: "updated" });
    expect(showWritePatch(body, true)).toEqual({
      description: "updated",
      agent_id: USER,
      is_verified: true,
      is_claimed: true,
      podscan_id: "pod",
      is_discoverable: false,
    });
  });
});
