import { describe, it, expect } from "vitest";
import { buildConversionAlertPayload } from "./conversion";

describe("buildConversionAlertPayload", () => {
  const profile = {
    id: "u-1",
    email: "founder@brand.com",
    full_name: "Jamie Founder",
    company_name: "Aurora Sleep",
  };

  it("at $12,500/mo Operator and PAYG cost the same — savings ~ 0", () => {
    // breakeven point: PAYG fee 10% × 12.5K = $1,250; Operator $499 + 6% × 12.5K = $499 + $750 = $1,249.
    // Annual delta = ($1,250 - $1,249) × 12 = $12.
    const payload = buildConversionAlertPayload({
      profile,
      monthlyAvgCents: 1_250_000,
    });
    expect(payload.subject).toContain("Aurora Sleep");
    expect(Math.abs(payload.operatorSavingsAnnualCents)).toBeLessThanOrEqual(
      5000
    ); // within ~$50/yr
    expect(payload.text).toContain("$12,500");
  });

  it("at $25,000/mo monthly spend Operator wins by ~$9,000/yr", () => {
    // PAYG: 0.10 × 25K = $2,500/mo. Operator: $499 + 0.06 × 25K = $1,999/mo.
    // Monthly delta $501 → annual $6,012.
    const payload = buildConversionAlertPayload({
      profile,
      monthlyAvgCents: 2_500_000,
    });
    expect(payload.operatorSavingsAnnualCents).toBeGreaterThan(500_000); // > $5,000/yr
    expect(payload.operatorSavingsAnnualCents).toBeLessThan(800_000); // < $8,000/yr
    expect(payload.html).toContain("$25,000");
  });

  it("at $50,000/mo Operator wins by ~$18k/yr", () => {
    // PAYG: 0.10 × 50K = $5,000/mo. Operator: $499 + 0.06 × 50K = $3,499/mo.
    // Monthly delta $1,501 → annual $18,012.
    const payload = buildConversionAlertPayload({
      profile,
      monthlyAvgCents: 5_000_000,
    });
    expect(payload.operatorSavingsAnnualCents).toBeGreaterThan(1_700_000);
    expect(payload.operatorSavingsAnnualCents).toBeLessThan(1_900_000);
  });

  it("falls back to email/id labels when company_name is missing", () => {
    const payload = buildConversionAlertPayload({
      profile: { id: "u-2", email: "a@b.com", company_name: null },
      monthlyAvgCents: 2_000_000,
    });
    // Expect either company_name absence triggers email or full_name use.
    expect(payload.subject).toMatch(/a@b\.com|u-2/);
  });

  it("includes both PAYG annual and Operator annual in the email body", () => {
    const payload = buildConversionAlertPayload({
      profile,
      monthlyAvgCents: 2_500_000,
    });
    // PAYG annual = $30,000; Operator annual = $23,988.
    expect(payload.text).toContain("$30,000");
    expect(payload.text).toContain("$23,988");
  });
});
