"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PLANS, type PlanId } from "@/lib/billing/plans";

export interface BillingProfileSnapshot {
  plan: PlanId;
  platformFeePercentage: number;
  seatCount: number;
  subscriptionStatus: "none" | "active" | "past_due" | "canceled" | "trialing";
  hasStripeSubscription: boolean;
}

const UPGRADE_TARGETS: Record<PlanId, Exclude<PlanId, "pay_as_you_go"> | null> = {
  pay_as_you_go: "operator",
  operator: "agency",
  agency: null,
};

function formatUsd(cents: number) {
  return `$${(cents / 100).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
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

  const upgradeTarget = UPGRADE_TARGETS[initial.plan];

  const handleUpgrade = () => {
    if (!upgradeTarget) return;
    setError(null);
    setInfo(null);
    startTransition(async () => {
      const res = await fetch("/api/billing/upgrade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetPlan: upgradeTarget }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? "Upgrade failed");
        return;
      }
      setInfo(`Upgraded to ${PLANS[upgradeTarget].label}.`);
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
      setInfo(
        `Downgrade scheduled. Your plan reverts to Pay-as-you-go on ${when}.`
      );
      router.refresh();
    });
  };

  const handleSeats = (delta: number) => {
    setError(null);
    setInfo(null);
    startTransition(async () => {
      const method = delta > 0 ? "POST" : "DELETE";
      const body = JSON.stringify({ delta: Math.abs(delta) });
      const res = await fetch("/api/billing/seats", {
        method,
        headers: { "Content-Type": "application/json" },
        body,
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? "Seat change failed");
        return;
      }
      setInfo(delta > 0 ? "Seat added." : "Seat removed.");
      router.refresh();
    });
  };

  const seatsAllowed = initial.plan !== "pay_as_you_go";

  return (
    <>
      {(error || info) && (
        <div
          className={`p-4 rounded-xl mb-6 text-sm ${
            error
              ? "bg-[var(--brand-error)]/10 border border-[var(--brand-error)]/30 text-[var(--brand-error)]"
              : "bg-[var(--brand-success)]/10 border border-[var(--brand-success)]/30 text-[var(--brand-success)]"
          }`}
        >
          {error ?? info}
        </div>
      )}

      {upgradeTarget && (
        <div className="p-5 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)] mb-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-semibold text-[var(--brand-text)]">
                Upgrade to {PLANS[upgradeTarget].label}
              </h2>
              <p className="text-sm text-[var(--brand-text-muted)] mt-1">
                {formatUsd(PLANS[upgradeTarget].monthlyBaseCents)}/mo +{" "}
                {(PLANS[upgradeTarget].feePercentage * 100).toFixed(0)}% transaction fee.
                {upgradeTarget === "operator" &&
                  " Breakeven vs. Pay-as-you-go at ~$12,500/mo spend."}
              </p>
            </div>
            <button
              onClick={handleUpgrade}
              disabled={isPending}
              className="px-4 py-2 rounded-lg bg-[var(--brand-blue)] hover:bg-[var(--brand-blue-light)] text-white text-sm font-medium transition-colors disabled:opacity-50"
            >
              {isPending ? "Working…" : `Upgrade`}
            </button>
          </div>
        </div>
      )}

      {seatsAllowed && (
        <div className="p-5 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)] mb-6">
          <div className="flex items-start justify-between gap-4 mb-2">
            <div>
              <h2 className="font-semibold text-[var(--brand-text)]">Seats</h2>
              <p className="text-sm text-[var(--brand-text-muted)] mt-1">
                {PLANS[initial.plan].seatsIncluded} included.{" "}
                {formatUsd(PLANS[initial.plan].additionalSeatCents)}/mo per
                additional seat.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleSeats(-1)}
                disabled={isPending || initial.seatCount <= 1}
                className="w-8 h-8 rounded-lg border border-[var(--brand-border)] text-[var(--brand-text)] hover:bg-[var(--brand-surface)] disabled:opacity-50 transition-colors"
              >
                −
              </button>
              <span className="w-8 text-center font-semibold text-[var(--brand-text)]">
                {initial.seatCount}
              </span>
              <button
                onClick={() => handleSeats(1)}
                disabled={isPending}
                className="w-8 h-8 rounded-lg border border-[var(--brand-border)] text-[var(--brand-text)] hover:bg-[var(--brand-surface)] disabled:opacity-50 transition-colors"
              >
                +
              </button>
            </div>
          </div>
        </div>
      )}

      {initial.plan !== "pay_as_you_go" && (
        <div className="p-5 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)] mb-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-semibold text-[var(--brand-text)]">
                Downgrade to Pay-as-you-go
              </h2>
              <p className="text-sm text-[var(--brand-text-muted)] mt-1">
                Takes effect at the end of your current billing period. You
                keep all features until then.
              </p>
            </div>
            <button
              onClick={handleDowngrade}
              disabled={isPending}
              className="px-4 py-2 rounded-lg border border-[var(--brand-border)] text-sm font-medium text-[var(--brand-text)] hover:bg-[var(--brand-surface)] disabled:opacity-50 transition-colors"
            >
              {isPending ? "Working…" : "Downgrade"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
