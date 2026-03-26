"use client";

import { useState, useEffect } from "react";

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
      <div className="p-5 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)] mb-6">
        <h2 className="font-semibold text-[var(--brand-text)] mb-4">Receive Payments</h2>
        <p className="text-sm text-[var(--brand-text-muted)]">Loading payout status...</p>
      </div>
    );
  }

  const isFullyOnboarded = status?.charges_enabled && status?.payouts_enabled;
  const isPartiallyOnboarded = status?.connected && !isFullyOnboarded;

  return (
    <div className="p-5 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)] mb-6">
      <h2 className="font-semibold text-[var(--brand-text)] mb-4">Receive Payments</h2>

      {isFullyOnboarded ? (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-[var(--brand-success)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-sm font-medium text-[var(--brand-success)]">Payouts enabled</span>
          </div>
          <a
            href="https://connect.stripe.com/express_login"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-[var(--brand-blue)] hover:underline"
          >
            Manage on Stripe
          </a>
        </div>
      ) : (
        <>
          <p className="text-sm text-[var(--brand-text-muted)] mb-4">
            {isPartiallyOnboarded
              ? "Complete your payout setup to start receiving payments."
              : "Connect your bank account to receive payouts from completed deals."}
          </p>
          <button
            onClick={handleConnect}
            disabled={actionLoading}
            className="px-4 py-2 rounded-lg bg-[var(--brand-blue)] hover:bg-[var(--brand-blue-light)] text-white text-sm font-medium transition-colors disabled:opacity-50"
          >
            {actionLoading ? "Redirecting..." : isPartiallyOnboarded ? "Continue Setup" : "Connect Bank Account"}
          </button>
          {error && <p className="text-sm text-[var(--brand-error)] mt-3">{error}</p>}
        </>
      )}
    </div>
  );
}
