import { describe, it, expect, vi, beforeEach } from "vitest";

const { fromMock, cookieStore } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  cookieStore: { get: vi.fn() },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ from: fromMock })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: vi.fn() },
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => cookieStore),
}));

import { getEffectiveRole } from "./queries";

const QUERY_MS = 80;

function chain(table: string) {
  const startedAt = Date.now();
  const finish = async (data: unknown) => {
    await new Promise((resolve) => setTimeout(resolve, QUERY_MS));
    return { data, error: null, startedAt };
  };
  const api = {
    select: () => api,
    eq: () => api,
    single: () =>
      finish(table === "profiles" ? { role: "brand", full_name: "Chris Taylor" } : null),
    maybeSingle: () =>
      finish(
        table === "brand_profiles"
          ? { id: "bp1", onboarded_at: "2026-01-01T00:00:00.000Z" }
          : null
      ),
  };
  return { api, startedAt };
}

describe("getEffectiveRole query schedule", () => {
  beforeEach(() => {
    fromMock.mockReset();
    cookieStore.get.mockReturnValue(undefined);
  });

  it("starts profile, brand, and show together", async () => {
    const starts: number[] = [];
    fromMock.mockImplementation((table: string) => {
      starts.push(Date.now());
      return chain(table).api;
    });

    const wallStart = Date.now();
    const role = await getEffectiveRole("user-1");
    const elapsed = Date.now() - wallStart;

    expect(role?.effectiveRole).toBe("brand");
    expect(starts).toHaveLength(3);
    const spread = Math.max(...starts) - Math.min(...starts);
    // Sequential awaits would spread the starts by about QUERY_MS each.
    expect(spread).toBeLessThan(QUERY_MS / 2);
    expect(elapsed).toBeLessThan(QUERY_MS * 2);
  });
});
