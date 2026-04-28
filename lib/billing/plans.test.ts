import { describe, it, expect } from "vitest";
import {
  PLANS,
  getPlan,
  getPlanForFeePercentage,
  monthlySavingsAtSpend,
  breakevenSpendCents,
} from "./plans";

describe("PLANS catalogue", () => {
  it("locks the three plan ids", () => {
    expect(Object.keys(PLANS).sort()).toEqual([
      "agency",
      "operator",
      "pay_as_you_go",
    ]);
  });

  it("matches the locked PRICING_DECISIONS.md numbers", () => {
    expect(PLANS.pay_as_you_go.feePercentage).toBe(0.10);
    expect(PLANS.pay_as_you_go.monthlyBaseCents).toBe(0);
    expect(PLANS.pay_as_you_go.seatsIncluded).toBe(1);

    expect(PLANS.operator.feePercentage).toBe(0.06);
    expect(PLANS.operator.monthlyBaseCents).toBe(49900);
    expect(PLANS.operator.additionalSeatCents).toBe(29900);
    expect(PLANS.operator.seatsIncluded).toBe(1);

    expect(PLANS.agency.feePercentage).toBe(0.04);
    expect(PLANS.agency.monthlyBaseCents).toBe(500000);
    expect(PLANS.agency.additionalSeatCents).toBe(50000);
    expect(PLANS.agency.seatsIncluded).toBe(5);
  });

  it("only Operator and Agency unlock the API/scale features", () => {
    expect(PLANS.pay_as_you_go.features.apiAccess).toBe(false);
    expect(PLANS.pay_as_you_go.features.unlimitedCampaigns).toBe(false);
    expect(PLANS.operator.features.apiAccess).toBe(true);
    expect(PLANS.operator.features.unlimitedCampaigns).toBe(true);
    expect(PLANS.agency.features.whiteLabel).toBe(true);
    expect(PLANS.agency.features.multiClient).toBe(true);
  });
});

describe("getPlan", () => {
  it("returns the matching record", () => {
    expect(getPlan("operator").label).toBe("Operator");
  });
});

describe("getPlanForFeePercentage", () => {
  it("reverse-looks-up exact fee percentages", () => {
    expect(getPlanForFeePercentage(0.10)?.id).toBe("pay_as_you_go");
    expect(getPlanForFeePercentage(0.06)?.id).toBe("operator");
    expect(getPlanForFeePercentage(0.04)?.id).toBe("agency");
  });

  it("tolerates the NUMERIC(5,4) round-trip from Postgres", () => {
    // Postgres NUMERIC(5,4) might come back as 0.1000000000001
    expect(getPlanForFeePercentage(0.0999999999)?.id).toBe("pay_as_you_go");
  });

  it("returns null for legacy custom rates", () => {
    expect(getPlanForFeePercentage(0.075)).toBeNull();
  });
});

describe("monthlySavingsAtSpend", () => {
  // Cents conversion: $5K = 500_000 cents, $12.5K = 1_250_000, etc.
  it("at $5K/mo PAYG beats Operator", () => {
    const { monthlyCents } = monthlySavingsAtSpend(500_000, "pay_as_you_go", "operator");
    // PAYG: 0 + 500_000 × 0.10 = 50_000
    // Operator: 49_900 + 500_000 × 0.06 = 79_900
    // Saving by switching to Operator: 50_000 - 79_900 = -29_900 (loss)
    expect(monthlyCents).toBe(-29_900);
  });

  it("at $12.5K/mo Operator and PAYG break even (within rounding)", () => {
    const { monthlyCents } = monthlySavingsAtSpend(1_250_000, "pay_as_you_go", "operator");
    // PAYG: 1_250_000 × 0.10 = 125_000
    // Operator: 49_900 + 1_250_000 × 0.06 = 124_900
    expect(monthlyCents).toBe(100); // within $1 of zero — the breakeven point
  });

  it("at $20K/mo Operator clearly wins over PAYG", () => {
    const { monthlyCents, annualCents } = monthlySavingsAtSpend(
      2_000_000,
      "pay_as_you_go",
      "operator"
    );
    // PAYG: 200_000; Operator: 49_900 + 120_000 = 169_900; saving 30_100
    expect(monthlyCents).toBe(30_100);
    expect(annualCents).toBe(30_100 * 12);
  });

  it("at $50K/mo savings are large", () => {
    const { monthlyCents } = monthlySavingsAtSpend(5_000_000, "pay_as_you_go", "operator");
    // PAYG: 500_000; Operator: 49_900 + 300_000 = 349_900; saving 150_100
    expect(monthlyCents).toBe(150_100);
  });

  it("rejects negative spend", () => {
    expect(() =>
      monthlySavingsAtSpend(-1, "pay_as_you_go", "operator")
    ).toThrow();
  });
});

describe("breakevenSpendCents", () => {
  it("PAYG vs Operator breakeven is $12,475", () => {
    // base_op - base_payg = 49_900; fee_payg - fee_op = 0.04
    // 49_900 / 0.04 = 1_247_500 cents = $12,475
    const breakeven = breakevenSpendCents("pay_as_you_go", "operator");
    expect(breakeven).toBe(1_247_500);
  });

  it("PAYG vs Agency breakeven is far higher", () => {
    // 500_000 / 0.06 = 8_333_333 cents
    const breakeven = breakevenSpendCents("pay_as_you_go", "agency");
    expect(breakeven).toBe(8_333_333);
  });

  it("returns null when feePercentage delta is zero", () => {
    expect(breakevenSpendCents("operator", "operator")).toBeNull();
  });
});
