import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { PLANS, type PlanId } from "@/lib/billing/plans";
import BillingClient, { type BillingProfileSnapshot } from "./billing-client";

export default async function BillingSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profileRow } = await supabaseAdmin
    .from("profiles")
    .select(
      "plan, platform_fee_percentage, seat_count, subscription_status, stripe_subscription_id"
    )
    .eq("id", user.id)
    .single();

  const plan: PlanId = (profileRow?.plan as PlanId) ?? "pay_as_you_go";
  const snapshot: BillingProfileSnapshot = {
    plan,
    platformFeePercentage: Number(profileRow?.platform_fee_percentage ?? 0.10),
    seatCount: Number(profileRow?.seat_count ?? 1),
    subscriptionStatus:
      (profileRow?.subscription_status as BillingProfileSnapshot["subscriptionStatus"]) ??
      "none",
    hasStripeSubscription: Boolean(profileRow?.stripe_subscription_id),
  };

  const planRecord = PLANS[plan];
  const formatUsd = (cents: number) =>
    `$${(cents / 100).toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })}`;
  const formatPct = (pct: number) => `${(pct * 100).toFixed(0)}%`;

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-2xl font-bold text-[var(--brand-text)] tracking-tight mb-1">
        Billing
      </h1>
      <p className="text-sm text-[var(--brand-text-secondary)] mb-8">
        Manage your subscription tier, transaction fee, and seats.
      </p>

      <div className="p-5 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)] mb-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="font-semibold text-[var(--brand-text)]">
              Current plan
            </h2>
            <p className="text-sm text-[var(--brand-text-muted)] mt-0.5">
              {planRecord.label}
              {planRecord.monthlyBaseCents > 0 &&
                ` — ${formatUsd(planRecord.monthlyBaseCents)}/mo`}
            </p>
          </div>
          <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-[var(--brand-blue)]/10 text-[var(--brand-blue)]">
            {snapshot.subscriptionStatus}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <div className="text-[var(--brand-text-muted)] text-xs uppercase tracking-wide">
              Transaction fee
            </div>
            <div className="font-semibold text-[var(--brand-text)] mt-1">
              {formatPct(snapshot.platformFeePercentage)}
            </div>
          </div>
          <div>
            <div className="text-[var(--brand-text-muted)] text-xs uppercase tracking-wide">
              Seats
            </div>
            <div className="font-semibold text-[var(--brand-text)] mt-1">
              {snapshot.seatCount}
            </div>
          </div>
          <div>
            <div className="text-[var(--brand-text-muted)] text-xs uppercase tracking-wide">
              Concurrent campaigns
            </div>
            <div className="font-semibold text-[var(--brand-text)] mt-1">
              {planRecord.concurrentCampaignCap ?? "Unlimited"}
            </div>
          </div>
        </div>
      </div>

      <BillingClient initial={snapshot} />
    </div>
  );
}
