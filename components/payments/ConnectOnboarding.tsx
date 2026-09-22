"use client";

import { useState, useEffect } from "react";
import { tokens } from "@/lib/brand/tokens";

const radiusStyle = { borderRadius: tokens.radius };
const inkText = "text-[var(--ts-ink-on-paper)]";
const mutedText = "text-[var(--ts-ink-muted-on-paper)]";
const accentText = "text-[var(--ts-accent)]";
const panelClass = "mb-6 border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] p-5";
const inkBtnClass =
  "inline-flex items-center bg-[var(--ts-ink-on-paper)] px-4 py-2 text-sm font-medium text-[var(--ts-paper)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";

interface ConnectStatus {
  connected: boolean;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
}

export default function ConnectOnboarding() {
  const [status, setStatus] = useState<ConnectStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchStatus();
  }, []);

  async function fetchStatus() {
    try {
      const res = await fetch("/api/stripe/connect/status");
      if (!res.ok) throw new Error("Failed to fetch connect status");
      const data = await res.json();
      setStatus(data);
    } catch {
      setStatus({ connected: false, charges_enabled: false, payouts_enabled: false, details_submitted: false });
    } finally {
      setLoading(false);
    }
  }

  async function handleConnect() {
    setActionLoading(true);
    setError(null);
    try {
      // Create account if not connected
      if (!status?.connected) {
        const createRes = await fetch("/api/stripe/connect/create-account", { method: "POST" });
        if (!createRes.ok) throw new Error("Failed to create connect account");
      }

      // Get onboarding link and redirect
      const linkRes = await fetch("/api/stripe/connect/onboarding-link", { method: "POST" });
      if (!linkRes.ok) throw new Error("Failed to create onboarding link");
      const { url } = await linkRes.json();
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setActionLoading(false);
    }
  }

  if (loading) {
    return (
      <div className={panelClass} style={radiusStyle}>
        <h2 className={`mb-4 font-semibold ${inkText}`}>Receive Payments</h2>
        <p className={`text-sm ${mutedText}`}>Loading payout status...</p>
      </div>
    );
  }

  const isFullyOnboarded = status?.charges_enabled && status?.payouts_enabled;
  const isPartiallyOnboarded = status?.connected && !isFullyOnboarded;

  return (
    <div className={panelClass} style={radiusStyle}>
      <h2 className={`mb-4 font-semibold ${inkText}`}>Receive Payments</h2>

      {isFullyOnboarded ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <svg className={`h-5 w-5 ${accentText}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className={`text-sm font-medium ${inkText}`}>Payouts enabled</span>
          </div>
          <a
            href="https://connect.stripe.com/express_login"
            target="_blank"
            rel="noopener noreferrer"
            className={`text-sm font-medium ${accentText} hover:underline`}
          >
            Manage on Stripe
          </a>
        </div>
      ) : (
        <>
          <p className={`mb-4 text-sm ${mutedText}`}>
            {isPartiallyOnboarded
              ? "Complete your payout setup to start receiving payments."
              : "Connect your bank account to receive payouts from completed deals."}
          </p>
          <button
            onClick={handleConnect}
            disabled={actionLoading}
            className={inkBtnClass}
            style={radiusStyle}
          >
            {actionLoading ? "Redirecting..." : isPartiallyOnboarded ? "Continue Setup" : "Connect Bank Account"}
          </button>
          {error && <p className={`mt-3 text-sm ${accentText}`}>{error}</p>}
        </>
      )}
    </div>
  );
}
