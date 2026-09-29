// Plan catalogue — locked 2026-09-28.
//
// Single source of truth for plan id, customer-facing label, card fee,
// monthly base, bank-transfer fee, and active-campaign cap. Charge-time
// math reads `profiles.platform_fee_percentage`. upgradeSubscription and
// finalizeDowngrade copy `feePercentage` from here onto that column.
//
// `bankFeePercentage` is data only. No charge path reads it until the
// separate ACH job ships. Card charges keep using `feePercentage`.
//
// Seats are no longer sold. `additionalSeatCents` is 0 on every plan.
// `seatsIncluded` is a soft cap in data only (Free 1, Starter 3,
// Operator 10). It is not enforced and not billed.
//
// The id `pay_as_you_go` stays so existing profile rows keep resolving.
// The customer-facing label is Free.
//
// Agency stays so legacy references and the profiles.plan check
// constraint still resolve. `public: false` excludes it from upgrade
// options and pricing copy.
//
// Card fees: Free 10%, Starter 8%, Operator 6%.
// Bank fees (data only): Free 7%, Starter 5%, Operator 3%.
// Active campaigns: Free 1, Starter 5, Operator unlimited (null).

export type PlanId = "pay_as_you_go" | "starter" | "operator" | "agency";

export const PLAN_IDS = {
  PAYG: "pay_as_you_go",
  STARTER: "starter",
  OPERATOR: "operator",
  AGENCY: "agency",
} as const;

/** Public catalogue order. Agency is intentionally absent. */
const PUBLIC_PLAN_ORDER: PlanId[] = ["pay_as_you_go", "starter", "operator"];

export interface PlanFeatures {
  apiAccess: boolean;
  whiteLabel: boolean;
  multiClient: boolean;
  prioritySupport: boolean;
  unlimitedCampaigns: boolean;
}

export interface PlanRecord {
  id: PlanId;
  label: string;
  /**
   * Card fee as a fraction, e.g. 0.10 for 10%. This is the rate written
   * to profiles.platform_fee_percentage on upgrade and downgrade.
   */
  feePercentage: number;
  /**
   * Bank-transfer fee as a fraction. Data only: not read by any charge
   * path until the separate ACH job ships.
   */
  bankFeePercentage: number;
  monthlyBaseCents: number;
  /** Always 0. Seats are no longer sold. */
  additionalSeatCents: number;
  /** Soft cap in data only. Not enforced and not billed. */
  seatsIncluded: number;
  /** Active-campaign cap. null = unlimited. Not enforced yet. */
  concurrentCampaignCap: number | null;
  /** False hides the plan from upgrade options and pricing copy. */
  public: boolean;
  features: PlanFeatures;
}

export const PLANS: Record<PlanId, PlanRecord> = {
  pay_as_you_go: {
    id: "pay_as_you_go",
    label: "Free",
    feePercentage: 0.10,
    bankFeePercentage: 0.07,
    monthlyBaseCents: 0,
    additionalSeatCents: 0,
    seatsIncluded: 1,
    concurrentCampaignCap: 1,
    public: true,
    features: {
      apiAccess: false,
      whiteLabel: false,
      multiClient: false,
      prioritySupport: false,
      unlimitedCampaigns: false,
    },
  },
  starter: {
    id: "starter",
    label: "Starter",
    feePercentage: 0.08,
    bankFeePercentage: 0.05,
    monthlyBaseCents: 7900,
    additionalSeatCents: 0,
    seatsIncluded: 3,
    concurrentCampaignCap: 5,
    public: true,
    features: {
      apiAccess: false,
      whiteLabel: false,
      multiClient: false,
      prioritySupport: false,
      unlimitedCampaigns: false,
    },
  },
  operator: {
    id: "operator",
    label: "Operator",
    feePercentage: 0.06,
    bankFeePercentage: 0.03,
    monthlyBaseCents: 29900,
    additionalSeatCents: 0,
    seatsIncluded: 10,
    concurrentCampaignCap: null,
    public: true,
    features: {
      apiAccess: true,
      whiteLabel: false,
      multiClient: false,
      prioritySupport: true,
      unlimitedCampaigns: true,
    },
  },
  agency: {
    id: "agency",
    label: "Agency",
    feePercentage: 0.04,
    // Legacy row only. Not a published bank rate.
    bankFeePercentage: 0.04,
    monthlyBaseCents: 500000,
    additionalSeatCents: 0,
    seatsIncluded: 5,
    concurrentCampaignCap: null,
    public: false,
    features: {
      apiAccess: true,
      whiteLabel: true,
      multiClient: true,
      prioritySupport: true,
      unlimitedCampaigns: true,
    },
  },
};

export function getPlan(id: PlanId): PlanRecord {
  const plan = PLANS[id];
  if (!plan) {
    throw new Error(`Unknown plan id: ${id}`);
  }
  return plan;
}

/** Free, Starter, and Operator, in catalogue order. Agency is excluded. */
export function listPublicPlans(): PlanRecord[] {
  return PUBLIC_PLAN_ORDER.map((id) => PLANS[id]).filter((plan) => plan.public);
}

/**
 * Reverse lookup — given a fee percentage, return the matching plan. Used
 * when reconciling state after a webhook hands us a fee % rather than a
 * plan id. Returns null if no plan matches exactly (i.e. legacy customer
 * with a custom rate). Comparison uses an epsilon to tolerate the
 * NUMERIC(5,4) round-trip from Postgres.
 */
export function getPlanForFeePercentage(pct: number): PlanRecord | null {
  const epsilon = 1e-6;
  for (const plan of Object.values(PLANS)) {
    if (Math.abs(plan.feePercentage - pct) < epsilon) return plan;
  }
  return null;
}

/**
 * Annualised savings, in cents, of moving from `fromPlan` to `toPlan` at a
 * given monthly transaction spend (also in cents).
 *
 * Math: monthly cost = monthlyBaseCents + spend × feePercentage. Multiply
 * the difference by 12 to get the annualised number used in conversion
 * alerts. Negative result means the move would cost more (e.g. low-volume
 * customers on Operator vs Free).
 *
 * Pure function — no Stripe, no DB, easy to unit test.
 */
export function monthlySavingsAtSpend(
  spendCents: number,
  fromPlan: PlanId,
  toPlan: PlanId
): { monthlyCents: number; annualCents: number } {
  if (spendCents < 0) {
    throw new Error("spendCents must be non-negative");
  }
  const from = getPlan(fromPlan);
  const to = getPlan(toPlan);

  const fromMonthly = from.monthlyBaseCents + spendCents * from.feePercentage;
  const toMonthly = to.monthlyBaseCents + spendCents * to.feePercentage;
  const monthlyCents = Math.round(fromMonthly - toMonthly);

  return {
    monthlyCents,
    annualCents: monthlyCents * 12,
  };
}

/**
 * Spend at which the customer breaks even between two plans (the point
 * where total monthly cost is equal). Used to surface "you'd save money
 * above $X/mo" copy in the upgrade UI.
 *
 * Returns null when the two plans have the same fee % (no crossover) or
 * when the lower-fee plan also has the lower base (no crossover needed).
 */
export function breakevenSpendCents(
  planA: PlanId,
  planB: PlanId
): number | null {
  const a = getPlan(planA);
  const b = getPlan(planB);
  const feeDelta = a.feePercentage - b.feePercentage;
  if (Math.abs(feeDelta) < 1e-9) return null;
  const baseDelta = b.monthlyBaseCents - a.monthlyBaseCents;
  // base_a + spend × fee_a = base_b + spend × fee_b
  // => spend = (base_b - base_a) / (fee_a - fee_b)
  const spend = baseDelta / feeDelta;
  return spend > 0 ? Math.round(spend) : null;
}
