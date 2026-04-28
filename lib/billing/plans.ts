// Wave 13 — Plan catalogue and pricing math.
//
// Single source of truth for what each tier costs, what fee % applies, how
// many seats are included, and which feature flags it unlocks. Every other
// piece of the billing system reads from here.
//
// IMPORTANT: per CLAUDE.md and PRICING_DECISIONS.md, no fee percentage is
// allowed to be hardcoded outside this file. All charge-time math reads
// either `profile.platform_fee_percentage` (per-customer) or the constants
// here (when computing what *would* apply on a different plan).

export type PlanId = "pay_as_you_go" | "operator" | "agency";

export const PLAN_IDS = {
  PAYG: "pay_as_you_go",
  OPERATOR: "operator",
  AGENCY: "agency",
} as const;

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
  /** Fractional fee, e.g. 0.10 for 10%. Stored numerically; UI formats. */
  feePercentage: number;
  monthlyBaseCents: number;
  /** $0 for PAYG; the per-extra-seat cents amount otherwise. */
  additionalSeatCents: number;
  /** Number of seats covered by the base subscription. */
  seatsIncluded: number;
  /** PAYG cap on concurrent active campaigns; null = unlimited. */
  concurrentCampaignCap: number | null;
  features: PlanFeatures;
}

export const PLANS: Record<PlanId, PlanRecord> = {
  pay_as_you_go: {
    id: "pay_as_you_go",
    label: "Pay-as-you-go",
    feePercentage: 0.10,
    monthlyBaseCents: 0,
    additionalSeatCents: 0,
    seatsIncluded: 1,
    concurrentCampaignCap: 2,
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
    monthlyBaseCents: 49900,
    additionalSeatCents: 29900,
    seatsIncluded: 1,
    concurrentCampaignCap: null,
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
    monthlyBaseCents: 500000,
    additionalSeatCents: 50000,
    seatsIncluded: 5,
    concurrentCampaignCap: null,
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
 * customers on Operator vs PAYG).
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
