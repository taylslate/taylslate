import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: { from: () => ({}) } }));
vi.mock("@/lib/stripe/server", () => ({ stripe: {} }));
vi.mock("@/lib/data/events", () => ({ logEvent: async () => null }));

import {
  PLANS,
  getPlan,
  getPlanForFeePercentage,
  listPublicPlans,
  monthlySavingsAtSpend,
  breakevenSpendCents,
} from "./plans";
import { computeApplicationFeeCents } from "@/lib/stripe/payment-intent";

describe("PLANS catalogue", () => {
  it("locks the plan ids", () => {
    expect(Object.keys(PLANS).sort()).toEqual([
      "agency",
      "operator",
      "pay_as_you_go",
      "starter",
    ]);
  });

  it("matches the locked 2026-09-28 numbers", () => {
    expect(PLANS.pay_as_you_go.label).toBe("Free");
    expect(PLANS.pay_as_you_go.feePercentage).toBe(0.10);
    expect(PLANS.pay_as_you_go.bankFeePercentage).toBe(0.07);
    expect(PLANS.pay_as_you_go.monthlyBaseCents).toBe(0);
    expect(PLANS.pay_as_you_go.additionalSeatCents).toBe(0);
    expect(PLANS.pay_as_you_go.seatsIncluded).toBe(1);
    expect(PLANS.pay_as_you_go.concurrentCampaignCap).toBe(1);
    expect(PLANS.pay_as_you_go.public).toBe(true);

    expect(PLANS.starter.label).toBe("Starter");
    expect(PLANS.starter.feePercentage).toBe(0.08);
    expect(PLANS.starter.bankFeePercentage).toBe(0.05);
    expect(PLANS.starter.monthlyBaseCents).toBe(7900);
    expect(PLANS.starter.additionalSeatCents).toBe(0);
    expect(PLANS.starter.seatsIncluded).toBe(3);
    expect(PLANS.starter.concurrentCampaignCap).toBe(5);
    expect(PLANS.starter.public).toBe(true);

    expect(PLANS.operator.label).toBe("Operator");
    expect(PLANS.operator.feePercentage).toBe(0.06);
    expect(PLANS.operator.bankFeePercentage).toBe(0.03);
    expect(PLANS.operator.monthlyBaseCents).toBe(29900);
    expect(PLANS.operator.additionalSeatCents).toBe(0);
    expect(PLANS.operator.seatsIncluded).toBe(10);
    expect(PLANS.operator.concurrentCampaignCap).toBeNull();
    expect(PLANS.operator.public).toBe(true);

    expect(PLANS.agency.public).toBe(false);
    expect(PLANS.agency.additionalSeatCents).toBe(0);
    expect(PLANS.agency.feePercentage).toBe(0.04);
    expect(PLANS.agency.monthlyBaseCents).toBe(500000);
    expect(PLANS.agency.seatsIncluded).toBe(5);
  });

  it("keeps Starter's active-campaign cap at 5", () => {
    expect(PLANS.starter.concurrentCampaignCap).toBe(5);
  });

  it("lists Free, Starter, and Operator and hides Agency", () => {
    expect(listPublicPlans().map((plan) => plan.id)).toEqual([
      "pay_as_you_go",
      "starter",
      "operator",
    ]);
    expect(listPublicPlans().map((plan) => plan.label)).toEqual([
      "Free",
      "Starter",
      "Operator",
    ]);
  });

  it("keeps API access on Operator and the legacy agency record", () => {
    expect(PLANS.pay_as_you_go.features.apiAccess).toBe(false);
    expect(PLANS.pay_as_you_go.features.unlimitedCampaigns).toBe(false);
    expect(PLANS.starter.features.apiAccess).toBe(false);
    expect(PLANS.starter.features.unlimitedCampaigns).toBe(false);
    expect(PLANS.operator.features.apiAccess).toBe(true);
    expect(PLANS.operator.features.unlimitedCampaigns).toBe(true);
    expect(PLANS.agency.features.whiteLabel).toBe(true);
    expect(PLANS.agency.features.multiClient).toBe(true);
  });
});

describe("getPlan", () => {
  it("returns the matching record", () => {
    expect(getPlan("operator").label).toBe("Operator");
    expect(getPlan("pay_as_you_go").label).toBe("Free");
    expect(getPlan("starter").label).toBe("Starter");
  });
});

describe("getPlanForFeePercentage", () => {
  it("resolves the locked card rates to the right plans", () => {
    expect(getPlanForFeePercentage(0.10)?.id).toBe("pay_as_you_go");
    expect(getPlanForFeePercentage(0.08)?.id).toBe("starter");
    expect(getPlanForFeePercentage(0.06)?.id).toBe("operator");
    expect(getPlanForFeePercentage(0.04)?.id).toBe("agency");
  });

  it("tolerates the NUMERIC(5,4) round-trip from Postgres", () => {
    expect(getPlanForFeePercentage(0.0999999999)?.id).toBe("pay_as_you_go");
    expect(getPlanForFeePercentage(0.0800000001)?.id).toBe("starter");
  });

  it("returns null for legacy custom rates", () => {
    expect(getPlanForFeePercentage(0.075)).toBeNull();
  });
});

describe("computeApplicationFeeCents at plan rates", () => {
  it("charges $25.00 / $20.00 / $15.00 on a $250.00 line", () => {
    expect(
      computeApplicationFeeCents(25000, PLANS.pay_as_you_go.feePercentage)
    ).toBe(2500);
    expect(computeApplicationFeeCents(25000, PLANS.starter.feePercentage)).toBe(
      2000
    );
    expect(
      computeApplicationFeeCents(25000, PLANS.operator.feePercentage)
    ).toBe(1500);
  });
});

describe("monthlySavingsAtSpend", () => {
  it("at $5K/mo Free costs less than Operator", () => {
    const { monthlyCents } = monthlySavingsAtSpend(500_000, "pay_as_you_go", "operator");
    // Free: 500_000 × 0.10 = 50_000
    // Operator: 29_900 + 500_000 × 0.06 = 59_900
    // Saving by switching to Operator: 50_000 - 59_900 = -9_900
    expect(monthlyCents).toBe(-9_900);
  });

  it("at the $7,475 breakeven Free and Operator cost the same", () => {
    const { monthlyCents } = monthlySavingsAtSpend(747_500, "pay_as_you_go", "operator");
    expect(monthlyCents).toBe(0);
  });

  it("at $12.5K/mo Operator saves against Free", () => {
    const { monthlyCents } = monthlySavingsAtSpend(1_250_000, "pay_as_you_go", "operator");
    // Free: 125_000
    // Operator: 29_900 + 75_000 = 104_900
    expect(monthlyCents).toBe(20_100);
  });

  it("at $20K/mo Operator clearly wins over Free", () => {
    const { monthlyCents, annualCents } = monthlySavingsAtSpend(
      2_000_000,
      "pay_as_you_go",
      "operator"
    );
    // Free: 200_000; Operator: 29_900 + 120_000 = 149_900; saving 50_100
    expect(monthlyCents).toBe(50_100);
    expect(annualCents).toBe(50_100 * 12);
  });

  it("at $50K/mo savings are large", () => {
    const { monthlyCents } = monthlySavingsAtSpend(5_000_000, "pay_as_you_go", "operator");
    // Free: 500_000; Operator: 29_900 + 300_000 = 329_900; saving 170_100
    expect(monthlyCents).toBe(170_100);
  });

  it("compares Free with Starter at the Starter breakeven", () => {
    const { monthlyCents } = monthlySavingsAtSpend(395_000, "pay_as_you_go", "starter");
    // Free: 39_500; Starter: 7_900 + 31_600 = 39_500
    expect(monthlyCents).toBe(0);
  });

  it("rejects negative spend", () => {
    expect(() =>
      monthlySavingsAtSpend(-1, "pay_as_you_go", "operator")
    ).toThrow();
  });
});

describe("breakevenSpendCents", () => {
  it("Free vs Operator breakeven is $7,475", () => {
    // 29_900 / 0.04 = 747_500 cents
    const breakeven = breakevenSpendCents("pay_as_you_go", "operator");
    expect(breakeven).toBe(747_500);
  });

  it("Free vs Starter breakeven is $3,950", () => {
    // 7_900 / 0.02 = 395_000 cents
    expect(breakevenSpendCents("pay_as_you_go", "starter")).toBe(395_000);
  });

  it("Free vs Agency breakeven stays on the legacy agency base", () => {
    // 500_000 / 0.06 = 8_333_333 cents
    const breakeven = breakevenSpendCents("pay_as_you_go", "agency");
    expect(breakeven).toBe(8_333_333);
  });

  it("returns null when feePercentage delta is zero", () => {
    expect(breakevenSpendCents("operator", "operator")).toBeNull();
  });
});
