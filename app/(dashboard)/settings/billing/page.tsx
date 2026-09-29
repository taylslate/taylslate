import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { PLANS, type PlanId } from "@/lib/billing/plans";
import { tokens } from "@/lib/brand/tokens";
import BillingClient, { type BillingProfileSnapshot } from "./billing-client";

const radiusStyle = { borderRadius: tokens.radius };
const inkText = "text-[var(--ts-ink-on-paper)]";
const mutedText = "text-[var(--ts-ink-muted-on-paper)]";
const accentText = "text-[var(--ts-accent)]";
const panelClass = "border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)]";
const kickerClass =
  "text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--ts-accent)]";

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
    <div className="max-w-2xl p-4 sm:p-8">
      <p className={kickerClass}>For brands</p>
      <h1 className={`mt-2 text-2xl font-semibold tracking-tight ${inkText}`}>
        Billing
      </h1>
      <p className={`mb-8 mt-1 text-sm ${mutedText}`}>
        Your plan, card fee, and how many campaigns can be active at once.
      </p>

      <div className={`mb-6 p-5 ${panelClass}`} style={radiusStyle}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className={`font-semibold ${inkText}`}>
              Current plan
            </h2>
            <p className={`mt-0.5 text-sm ${mutedText}`}>
              {planRecord.public ? planRecord.label : "Legacy plan"}
              {` — ${formatUsd(planRecord.monthlyBaseCents)}/mo`}
            </p>
          </div>
          <span className={`text-xs font-medium ${mutedText}`}>
            {snapshot.subscriptionStatus}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
          <div>
            <div className={`text-xs uppercase tracking-wide ${mutedText}`}>
              Card fee
            </div>
            <div className={`mt-1 font-semibold ${inkText}`}>
              {formatPct(snapshot.platformFeePercentage)}
            </div>
            <p className={`mt-1 text-xs ${mutedText}`}>on top of the show rate</p>
          </div>
          <div>
            <div className={`text-xs uppercase tracking-wide ${mutedText}`}>
              Active campaigns
            </div>
            <div className={`mt-1 font-semibold ${inkText}`}>
              {planRecord.concurrentCampaignCap ?? "Unlimited"}
            </div>
          </div>
        </div>
        {planRecord.public && (
          <p className={`mt-4 text-xs ${mutedText}`}>
            Pay by bank transfer: {formatPct(planRecord.bankFeePercentage)} (coming soon)
          </p>
        )}
      </div>

      <BillingClient initial={snapshot} />
    </div>
  );
}
