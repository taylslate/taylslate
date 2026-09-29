"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PLANS, listPublicPlans, type PlanId } from "@/lib/billing/plans";
import { tokens } from "@/lib/brand/tokens";

const radiusStyle = { borderRadius: tokens.radius };
const inkText = "text-[var(--ts-ink-on-paper)]";
const mutedText = "text-[var(--ts-ink-muted-on-paper)]";
const accentText = "text-[var(--ts-accent)]";
const panelClass = "border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)]";
const inkBtnClass =
  "inline-flex items-center bg-[var(--ts-ink-on-paper)] px-4 py-2 text-sm font-medium text-[var(--ts-paper)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";
const ghostBtnClass =
  "inline-flex items-center justify-center border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] text-sm font-medium text-[var(--ts-ink-on-paper)] hover:bg-[var(--ts-band-shows)] disabled:cursor-not-allowed disabled:opacity-50";

export interface BillingProfileSnapshot {
  plan: PlanId;
  platformFeePercentage: number;
  seatCount: number;
  subscriptionStatus: "none" | "active" | "past_due" | "canceled" | "trialing";
  hasStripeSubscription: boolean;
}

function formatUsd(cents: number) {
  return `$${(cents / 100).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

function formatPct(pct: number) {
  return `${(pct * 100).toFixed(0)}%`;
}

function campaignLimit(cap: number | null) {
  if (cap === null) return "Unlimited active campaigns";
  if (cap === 1) return "1 active campaign";
  return `${cap} active campaigns`;
}

export default function BillingClient({
  initial,
}: {
  initial: BillingProfileSnapshot;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const currentBase = PLANS[initial.plan].monthlyBaseCents;
  const publicPlans = listPublicPlans();

  const handleUpgrade = (targetPlan: Exclude<PlanId, "pay_as_you_go">) => {
    setError(null);
    setInfo(null);
    startTransition(async () => {
      const res = await fetch("/api/billing/upgrade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetPlan }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? "Upgrade failed");
        return;
      }
      setInfo(`Upgraded to ${PLANS[targetPlan].label}.`);
      router.refresh();
    });
  };

  const handleDowngrade = () => {
    if (initial.plan === "pay_as_you_go") return;
    setError(null);
    setInfo(null);
    startTransition(async () => {
      const res = await fetch("/api/billing/downgrade", { method: "POST" });
      const json = (await res.json()) as {
        effectiveAt?: string | null;
        error?: string;
      };
      if (!res.ok) {
        setError(json.error ?? "Downgrade failed");
        return;
      }
      const when = json.effectiveAt
        ? new Date(json.effectiveAt).toLocaleDateString()
        : "the end of your billing period";
      setInfo(`Downgrade scheduled. Your plan reverts to Free on ${when}.`);
      router.refresh();
    });
  };

  return (
    <>
      {(error || info) && (
        <div
          className={`mb-6 border p-4 text-sm ${
            error
              ? "border-[var(--ts-hairline-on-paper)] bg-[var(--ts-band-brands)] text-[var(--ts-accent)]"
              : "border-[var(--ts-hairline-on-paper)] bg-[var(--ts-band-shows)] text-[var(--ts-ink-on-paper)]"
          }`}
          style={radiusStyle}
        >
          {error ?? info}
        </div>
      )}

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {publicPlans.map((plan) => {
          const isCurrent = plan.id === initial.plan;
          const canUpgrade =
            plan.id !== "pay_as_you_go" &&
            plan.monthlyBaseCents > currentBase;
          return (
            <div key={plan.id} className={`p-4 ${panelClass}`} style={radiusStyle}>
              <div className="mb-0.5 flex items-center justify-between gap-2">
                <h2 className={`font-semibold ${inkText}`}>{plan.label}</h2>
                {isCurrent && (
                  <span className={`text-[10px] font-medium uppercase tracking-wider ${accentText}`}>
                    Current
                  </span>
                )}
              </div>
              <div className={`text-lg font-semibold ${inkText}`}>
                {formatUsd(plan.monthlyBaseCents)}
                <span className={`text-xs font-normal ${mutedText}`}>/mo</span>
              </div>
              <p className={`mt-1 text-xs ${mutedText}`}>
                {formatPct(plan.feePercentage)} card fee, on top of the show rate
              </p>
              <p className={`mt-1 text-xs ${mutedText}`}>
                {campaignLimit(plan.concurrentCampaignCap)}
              </p>
              <p className={`mt-2 text-xs leading-snug ${mutedText}`}>
                Pay by bank transfer: {formatPct(plan.bankFeePercentage)} (coming soon)
              </p>
              {canUpgrade && (
                <button
                  type="button"
                  onClick={() => {
                    if (plan.id === "pay_as_you_go") return;
                    handleUpgrade(plan.id);
                  }}
                  disabled={isPending}
                  className={`mt-4 ${inkBtnClass}`}
                  style={radiusStyle}
                  aria-label={`Upgrade to ${plan.label}`}
                >
                  {isPending ? "Working…" : "Upgrade"}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {initial.plan !== "pay_as_you_go" && (
        <div className={`mb-6 p-5 ${panelClass}`} style={radiusStyle}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className={`font-semibold ${inkText}`}>
                Downgrade to Free
              </h2>
              <p className={`mt-1 text-sm ${mutedText}`}>
                Takes effect at the end of your current billing period. Your
                card fee stays until then.
              </p>
            </div>
            <button
              type="button"
              onClick={handleDowngrade}
              disabled={isPending}
              className={`px-4 py-2 ${ghostBtnClass}`}
              style={radiusStyle}
            >
              {isPending ? "Working…" : "Downgrade"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
