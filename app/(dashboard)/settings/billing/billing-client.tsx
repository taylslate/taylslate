"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PLANS, type PlanId } from "@/lib/billing/plans";
import { tokens } from "@/lib/brand/tokens";

const radiusStyle = { borderRadius: tokens.radius };
const inkText = "text-[var(--ts-ink-on-paper)]";
const mutedText = "text-[var(--ts-ink-muted-on-paper)]";
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

      {upgradeTarget && (
        <div className={`mb-6 p-5 ${panelClass}`} style={radiusStyle}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className={`font-semibold ${inkText}`}>
                Upgrade to {PLANS[upgradeTarget].label}
              </h2>
              <p className={`mt-1 text-sm ${mutedText}`}>
                {formatUsd(PLANS[upgradeTarget].monthlyBaseCents)}/mo +{" "}
                {(PLANS[upgradeTarget].feePercentage * 100).toFixed(0)}% transaction fee.
                {upgradeTarget === "operator" &&
                  " Breakeven vs. Pay-as-you-go at ~$12,500/mo spend."}
              </p>
            </div>
            <button
              onClick={handleUpgrade}
              disabled={isPending}
              className={inkBtnClass}
              style={radiusStyle}
            >
              {isPending ? "Working…" : `Upgrade`}
            </button>
          </div>
        </div>
      )}

      {seatsAllowed && (
        <div className={`mb-6 p-5 ${panelClass}`} style={radiusStyle}>
          <div className="mb-2 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className={`font-semibold ${inkText}`}>Seats</h2>
              <p className={`mt-1 text-sm ${mutedText}`}>
                {PLANS[initial.plan].seatsIncluded} included.{" "}
                {formatUsd(PLANS[initial.plan].additionalSeatCents)}/mo per
                additional seat.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleSeats(-1)}
                disabled={isPending || initial.seatCount <= 1}
                className={`h-8 w-8 ${ghostBtnClass}`}
                style={radiusStyle}
              >
                −
              </button>
              <span className={`w-8 text-center font-semibold ${inkText}`}>
                {initial.seatCount}
              </span>
              <button
                onClick={() => handleSeats(1)}
                disabled={isPending}
                className={`h-8 w-8 ${ghostBtnClass}`}
                style={radiusStyle}
              >
                +
              </button>
            </div>
          </div>
        </div>
      )}

      {initial.plan !== "pay_as_you_go" && (
        <div className={`mb-6 p-5 ${panelClass}`} style={radiusStyle}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className={`font-semibold ${inkText}`}>
                Downgrade to Pay-as-you-go
              </h2>
              <p className={`mt-1 text-sm ${mutedText}`}>
                Takes effect at the end of your current billing period. You
                keep all features until then.
              </p>
            </div>
            <button
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
