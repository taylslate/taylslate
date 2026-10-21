// A pending roster link does not put the show in representedShowIds.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { adminFrom } = vi.hoisted(() => ({
  adminFrom: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: (...args: unknown[]) => adminFrom(...args) },
}));

vi.mock("@/lib/auth/admin", () => ({
  isInternalAdmin: () => false,
}));

vi.mock("@/lib/data/reasoning-log", () => ({
  getLatestCampaignPatternForCampaign: vi.fn(async () => null),
}));

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: vi.fn(),
  getCampaignById: vi.fn(async () => ({
    id: "camp-1",
    user_id: "agent-1",
    name: "Test",
    status: "active",
    brand_profile_id: null,
    brief: { target_interests: [], keywords: [] },
    budget_total: 0,
    platforms: ["podcast"],
    recommendations: [],
  })),
  getUserProfile: vi.fn(async () => ({ role: "agent" })),
}));

import { resolveLearningPage } from "./load";

type Mode = "pending" | "approved";

let mode: Mode = "pending";

function builder(table: string) {
  const filters: Record<string, unknown> = {};
  const result = () => {
    if (table === "deals" && filters.campaign_id === "camp-1") {
      return {
        data: [
          {
            id: "deal-1",
            show_id: "show-1",
            campaign_id: "camp-1",
            agent_id: "someone-else",
            status: "live",
          },
        ],
        error: null,
      };
    }
    if (table === "deals") return { data: [], error: null };
    if (table === "shows") {
      return { data: [{ id: "show-1", name: "Night Desk" }], error: null };
    }
    if (table === "agent_show_relationships") {
      const row = { show_id: "show-1" };
      if (mode === "pending") {
        return filters.status === "approved"
          ? { data: [], error: null }
          : { data: [row], error: null };
      }
      return filters.status === "approved"
        ? { data: [row], error: null }
        : { data: [], error: null };
    }
    return { data: [], error: null };
  };
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = vi.fn(self);
  chain.eq = vi.fn((column: string, value: unknown) => {
    filters[column] = value;
    return chain;
  });
  chain.in = vi.fn(self);
  chain.maybeSingle = vi.fn(async () => result());
  chain.then = (
    resolve: (value: ReturnType<typeof result>) => unknown,
    reject?: (reason: unknown) => unknown
  ) => Promise.resolve(result()).then(resolve, reject);
  return chain;
}

beforeEach(() => {
  mode = "pending";
  adminFrom.mockReset();
  adminFrom.mockImplementation((table: string) => builder(table));
});

describe("representedShowIds", () => {
  it("leaves a pending link out and keeps an approved link", async () => {
    const pending = await resolveLearningPage({ id: "agent-1" }, "camp-1");
    expect(pending?.bundle.allowedShowIds).toContain("show-1");
    expect(pending?.representedShowIds).not.toContain("show-1");

    mode = "approved";
    const approved = await resolveLearningPage({ id: "agent-1" }, "camp-1");
    expect(approved?.representedShowIds).toContain("show-1");
  });
});
