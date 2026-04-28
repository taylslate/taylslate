// Wave 13 — GMV (Gross Merchandise Volume) analytics.
//
// Reads the `payments` table to compute trailing-window transaction
// volume per customer. The single most important downstream consumer is
// the conversion-alert cron: when a Pay-as-you-go customer's trailing
// 90-day monthly average exceeds the Operator breakeven (~$12,500/mo)
// they cost more on PAYG than on Operator and should hear from us.
//
// All amounts are in cents end-to-end. Conversions to dollars happen at
// the UI/email rendering boundary.

import { supabaseAdmin } from "@/lib/supabase/admin";

export interface TrailingGmv {
  totalCents: number;
  dailyAvgCents: number;
  monthlyAvgCents: number;
  periodStart: string;
  periodEnd: string;
}

/**
 * Sum of `succeeded` payments for a customer over the last `days` days.
 *
 * The customer is identified via the deal: `payments.deal_id → deals.brand_id`.
 * Returns zeroed totals (never null) when the customer has no qualifying
 * payments in the window — callers don't need to defend against missing
 * rows.
 */
export async function getTrailingGmv(
  customerId: string,
  days = 90
): Promise<TrailingGmv> {
  const periodEndDate = new Date();
  const periodStartDate = new Date(
    periodEndDate.getTime() - days * 86_400_000
  );
  const periodStart = periodStartDate.toISOString();
  const periodEnd = periodEndDate.toISOString();

  const { data, error } = await supabaseAdmin
    .from("payments")
    .select("amount_charged_cents, deals!inner(brand_id)")
    .eq("status", "succeeded")
    .eq("deals.brand_id", customerId)
    .gte("charged_at", periodStart)
    .lte("charged_at", periodEnd);

  if (error) {
    console.warn(
      "[analytics/gmv.getTrailingGmv] query failed:",
      error.message,
      error.code
    );
    return {
      totalCents: 0,
      dailyAvgCents: 0,
      monthlyAvgCents: 0,
      periodStart,
      periodEnd,
    };
  }

  const rows = (data ?? []) as Array<{ amount_charged_cents: number | null }>;
  const totalCents = rows.reduce(
    (sum, row) => sum + (row.amount_charged_cents ?? 0),
    0
  );

  // Use the configured window (days) for averaging rather than the
  // populated date range — partial windows still average against the
  // full intended denominator, which is what the conversion threshold
  // assumes ("trailing 90 monthly average" = total / (90/30)).
  const dailyAvgCents = days > 0 ? Math.round(totalCents / days) : 0;
  const monthlyAvgCents = days > 0 ? Math.round((totalCents / days) * 30) : 0;

  return {
    totalCents,
    dailyAvgCents,
    monthlyAvgCents,
    periodStart,
    periodEnd,
  };
}

export interface PaygCustomerOverBreakeven {
  customerId: string;
  monthlyAvgCents: number;
}

/**
 * Returns every Pay-as-you-go customer whose trailing-90 monthly average
 * GMV exceeds `thresholdCents`. Used by the conversion-alert cron to
 * decide who to nudge into Operator. Defaults to $12,500/mo (Operator
 * breakeven).
 *
 * Implementation note: we fetch all PAYG profile ids first, then call
 * getTrailingGmv per-customer. Volumes are small (early Wave 13). When
 * the customer count grows, replace with a single SQL aggregate.
 */
export async function getAllPaygCustomersAboveBreakeven(
  thresholdCents = 1_250_000
): Promise<PaygCustomerOverBreakeven[]> {
  const { data: profiles, error } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("plan", "pay_as_you_go");

  if (error) {
    console.warn(
      "[analytics/gmv.getAllPaygCustomersAboveBreakeven] profile query failed:",
      error.message
    );
    return [];
  }

  const results: PaygCustomerOverBreakeven[] = [];
  for (const row of profiles ?? []) {
    const customerId = (row as { id: string }).id;
    const gmv = await getTrailingGmv(customerId, 90);
    if (gmv.monthlyAvgCents > thresholdCents) {
      results.push({ customerId, monthlyAvgCents: gmv.monthlyAvgCents });
    }
  }
  return results;
}
