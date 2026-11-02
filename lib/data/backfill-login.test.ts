import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAuthEmail, rows } = vi.hoisted(() => ({
  getAuthEmail: vi.fn(),
  rows: {
    profiles: [] as Record<string, unknown>[],
    outreaches: [] as Record<string, unknown>[],
    deals: [] as Record<string, unknown>[],
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
    from: () => ({}),
  }),
}));

vi.mock("@/lib/auth/auth-email", () => ({
  getAuthEmail: (...args: unknown[]) => getAuthEmail(...args),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from(table: string) {
      const filters: { column: string; value: unknown }[] = [];
      let patch: Record<string, unknown> | null = null;
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          filters.push({ column, value });
          return builder;
        },
        ilike: (column: string, value: unknown) => {
          filters.push({ column, value: String(value).toLowerCase() });
          return builder;
        },
        in: (column: string, value: unknown) => {
          filters.push({ column, value });
          return builder;
        },
        is: () => builder,
        update: (next: Record<string, unknown>) => {
          patch = next;
          return builder;
        },
        maybeSingle: async () => {
          const tableRows = rows[table as keyof typeof rows] ?? [];
          const hit = tableRows.find((row) =>
            filters.every((filter) => row[filter.column] === filter.value),
          );
          return { data: hit ?? null, error: null };
        },
        then: (
          resolve: (value: { data: unknown; error: null }) => unknown,
          reject?: (reason: unknown) => unknown,
        ) => {
          const tableRows = rows[table as keyof typeof rows] ?? [];
          const hits = tableRows.filter((row) =>
            filters.every((filter) => {
              if (Array.isArray(filter.value)) return filter.value.includes(row[filter.column]);
              const cell = row[filter.column];
              return String(cell ?? "").toLowerCase() === String(filter.value ?? "").toLowerCase();
            }),
          );
          if (patch) {
            for (const row of hits) Object.assign(row, patch);
          }
          return Promise.resolve({ data: hits, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  },
}));

import { backfillShowProfileOnAcceptedDeals } from "./queries";

const ATTACKER = "11111111-1111-4111-8111-111111111111";
const SHOW_PROFILE = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  getAuthEmail.mockReset();
  rows.profiles = [{ id: ATTACKER, role: "show", email: "victim@show.test" }];
  rows.outreaches = [{ id: "out-victim", sent_to_email: "victim@show.test" }];
  rows.deals = [{ id: "deal-1", outreach_id: "out-victim", show_profile_id: null }];
});

describe("backfillShowProfileOnAcceptedDeals", () => {
  it("does not attach the victim's deals when profiles.email was copied", async () => {
    getAuthEmail.mockResolvedValue("attacker@example.test");
    const linked = await backfillShowProfileOnAcceptedDeals(SHOW_PROFILE, ATTACKER);
    expect(linked).toBe(0);
    expect(rows.deals[0].show_profile_id).toBeNull();
  });

  it("attaches deals for the auth login", async () => {
    getAuthEmail.mockResolvedValue("victim@show.test");
    const linked = await backfillShowProfileOnAcceptedDeals(SHOW_PROFILE, ATTACKER);
    expect(linked).toBe(1);
    expect(rows.deals[0].show_profile_id).toBe(SHOW_PROFILE);
  });
});
