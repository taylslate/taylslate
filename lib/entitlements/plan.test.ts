import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClient, from } = vi.hoisted(() => {
  const from = vi.fn();
  return {
    from,
    createClient: vi.fn(async () => ({ from })),
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createClient,
}));

import { getPlan, type PlanId } from "@/lib/billing/plans";
import { canUseCrm, getProfilePlanId } from "./plan";

const FREE_PLAN_ID: PlanId = getPlan("pay_as_you_go").id;
const PLAN_IDS: PlanId[] = ["pay_as_you_go", "starter", "operator", "agency"];

function mockProfileRead(result: {
  data: { plan: unknown } | null;
  error: { code?: string; message?: string } | null;
}) {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    single: vi.fn(),
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.single.mockResolvedValue(result);
  from.mockReturnValue(builder);
  return builder;
}

function mockProfilePlan(plan: unknown) {
  return mockProfileRead({ data: { plan }, error: null });
}

describe("getProfilePlanId", () => {
  beforeEach(() => {
    from.mockReset();
    createClient.mockClear();
  });

  it.each(PLAN_IDS)("returns %s when profiles.plan is that id", async (planId) => {
    const builder = mockProfilePlan(planId);

    await expect(getProfilePlanId("user-1")).resolves.toBe(planId);

    expect(createClient).toHaveBeenCalledOnce();
    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith("profiles");
    expect(builder.select).toHaveBeenCalledWith("plan");
    expect(builder.eq).toHaveBeenCalledWith("id", "user-1");
    expect(builder.single).toHaveBeenCalledOnce();
  });

  it("falls back to the Free plan id when plan is null", async () => {
    mockProfilePlan(null);

    await expect(getProfilePlanId("user-1")).resolves.toBe(FREE_PLAN_ID);
  });

  it("falls back to the Free plan id when the row is missing", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockProfileRead({
      data: null,
      error: { code: "PGRST116", message: "no rows" },
    });

    try {
      await expect(getProfilePlanId("user-1")).resolves.toBe(FREE_PLAN_ID);
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("logs a database error such as 42501 and still falls back to Free", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockProfileRead({
      data: null,
      error: {
        code: "42501",
        message: "permission denied for table profiles",
      },
    });

    try {
      await expect(getProfilePlanId("user-1")).resolves.toBe(FREE_PLAN_ID);
      expect(errorSpy).toHaveBeenCalledWith(
        "[getProfilePlanId] profiles.plan read failed:",
        "42501",
        "permission denied for table profiles",
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("falls back to the Free plan id when the value is unknown", async () => {
    mockProfilePlan("enterprise");

    await expect(getProfilePlanId("user-1")).resolves.toBe(FREE_PLAN_ID);
  });

  it("falls back to the Free plan id for an inherited key such as toString", async () => {
    mockProfilePlan("toString");

    await expect(getProfilePlanId("user-1")).resolves.toBe(FREE_PLAN_ID);
  });
});

describe("canUseCrm", () => {
  it.each(PLAN_IDS)("gates %s", (planId) => {
    const allowed = planId === "starter" || planId === "operator" || planId === "agency";
    expect(canUseCrm(planId)).toBe(allowed);
  });

  it("is true for the legacy agency plan", () => {
    expect(canUseCrm("agency")).toBe(true);
  });
});
