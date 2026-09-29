import { describe, it, expect } from "vitest";
import { buildConversionAlertPayload } from "./conversion";

describe("buildConversionAlertPayload", () => {
  const profile = {
    id: "u-1",
    email: "founder@brand.com",
    full_name: "Jamie Founder",
    company_name: "Aurora Sleep",
  };

  it("at $12,500/mo compares Free with Starter and Operator", () => {
    // Free: 0.10 × 12.5K = $1,250/mo → $15,000/yr.
    // Starter: $79 + 0.08 × 12.5K = $1,079/mo → $12,948/yr. Save $2,052/yr.
    // Operator: $299 + 0.06 × 12.5K = $1,049/mo → $12,588/yr. Save $2,412/yr.
    const payload = buildConversionAlertPayload({
      profile,
      monthlyAvgCents: 1_250_000,
    });
    expect(payload.subject).toContain("Aurora Sleep");
    expect(payload.operatorSavingsAnnualCents).toBe(241_200);
    expect(payload.starterSavingsAnnualCents).toBe(205_200);
    expect(payload.text).toContain("$12,500");
    expect(payload.text).toContain("Starter");
    expect(payload.text).toContain("Operator");
    expect(payload.text).toContain("$79/mo + 8%");
    expect(payload.text).toContain("$299/mo + 6%");
    expect(payload.html).not.toContain("$499");
    expect(payload.text).not.toContain("Agency");
  });

  it("at $25,000/mo Operator saves $8,412/yr against Free", () => {
    // Free: $2,500/mo → $30,000/yr.
    // Starter: $79 + $2,000 = $2,079/mo → $24,948/yr. Save $5,052/yr.
    // Operator: $299 + $1,500 = $1,799/mo → $21,588/yr. Save $8,412/yr.
    const payload = buildConversionAlertPayload({
      profile,
      monthlyAvgCents: 2_500_000,
    });
    expect(payload.operatorSavingsAnnualCents).toBe(841_200);
    expect(payload.starterSavingsAnnualCents).toBe(505_200);
    expect(payload.html).toContain("$25,000");
  });

  it("at $50,000/mo Operator saves $20,412/yr against Free", () => {
    // Free: $5,000/mo. Operator: $299 + $3,000 = $3,299/mo.
    // Monthly delta $1,701 → annual $20,412.
    const payload = buildConversionAlertPayload({
      profile,
      monthlyAvgCents: 5_000_000,
    });
    expect(payload.operatorSavingsAnnualCents).toBe(2_041_200);
    expect(payload.starterSavingsAnnualCents).toBe(1_105_200);
  });

  it("falls back to email/id labels when company_name is missing", () => {
    const payload = buildConversionAlertPayload({
      profile: { id: "u-2", email: "a@b.com", company_name: null },
      monthlyAvgCents: 2_000_000,
    });
    expect(payload.subject).toMatch(/a@b\.com|u-2/);
  });

  it("includes Free, Starter, and Operator annual costs in the email body", () => {
    const payload = buildConversionAlertPayload({
      profile,
      monthlyAvgCents: 2_500_000,
    });
    expect(payload.text).toContain("$30,000");
    expect(payload.text).toContain("$24,948");
    expect(payload.text).toContain("$21,588");
    expect(payload.html).toContain("Free");
    expect(payload.html).toContain("Starter");
  });
});
