import { beforeEach, describe, expect, it, vi } from "vitest";

const getProfilePlanId = vi.fn();
const inserts: Array<Record<string, unknown>> = [];
let existing = false;
let failCode: string | null = null;

vi.mock("@/lib/entitlements/plan", () => ({
  getProfilePlanId: (...args: unknown[]) => getProfilePlanId(...args),
  canUseCrm: (planId: string) => planId === "starter" || planId === "operator" || planId === "agency",
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () =>
              failCode
                ? { data: null, error: { code: failCode, message: "secret host@example.test" } }
                : { data: existing ? { id: "row-1" } : null, error: null },
          }),
        }),
      }),
      insert: async (payload: Record<string, unknown>) => {
        inserts.push(payload);
        return { error: null };
      },
    }),
  },
}));

import { addBrandToShowCrmOnFirstResponse, addShowToBrandCrmOnOutreach } from "./crm";

const outreach = { id: "o1", show_id: "33333333-3333-4333-8333-333333333333" };

describe("relay crm", () => {
  beforeEach(() => {
    inserts.length = 0;
    existing = false;
    failCode = null;
    getProfilePlanId.mockResolvedValue("starter");
  });

  it("inserts a catalog show once for a CRM plan and never an email", async () => {
    const added = await addShowToBrandCrmOnOutreach({ brandUserId: "brand-1", outreach });
    expect(added).toEqual({ added: true });
    expect(inserts).toEqual([
      {
        brand_id: "brand-1",
        show_id: outreach.show_id,
        source: "outreach",
        outreach_id: "o1",
      },
    ]);
    expect(Object.keys(inserts[0])).not.toContain("email");
    expect(Object.keys(inserts[0])).not.toContain("phone");
    expect(JSON.stringify(inserts)).not.toContain("@");
  });

  it("writes nothing on the free plan", async () => {
    getProfilePlanId.mockResolvedValue("pay_as_you_go");
    expect(await addShowToBrandCrmOnOutreach({ brandUserId: "brand-1", outreach })).toEqual({
      added: false,
      reason: "no_crm_access",
    });
    expect(inserts).toHaveLength(0);
  });

  it("writes nothing for a podscan-only outreach", async () => {
    expect(
      await addShowToBrandCrmOnOutreach({ brandUserId: "brand-1", outreach: { id: "o1", show_id: null } })
    ).toEqual({ added: false, reason: "no_catalog_show" });
    expect(inserts).toHaveLength(0);
  });

  it("reports an existing row without inserting again", async () => {
    existing = true;
    expect(await addShowToBrandCrmOnOutreach({ brandUserId: "brand-1", outreach })).toEqual({
      added: false,
      reason: "exists",
    });
    expect(inserts).toHaveLength(0);
  });

  it("does not write a show CRM row", async () => {
    getProfilePlanId.mockClear();
    expect(await addBrandToShowCrmOnFirstResponse({ brandUserId: "brand-1", outreachId: "o1" })).toEqual({
      added: false,
      reason: "no_show_crm",
    });
    expect(inserts).toHaveLength(0);
    expect(getProfilePlanId).not.toHaveBeenCalled();
  });
});
