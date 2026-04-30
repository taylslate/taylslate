"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import ConnectOnboarding from "@/components/payments/ConnectOnboarding";
import CardForm from "@/components/payments/CardForm";
import SignOutButton from "@/components/auth/SignOutButton";
import { PLANS, type PlanId } from "@/lib/billing/plans";

type UserRole = "brand" | "agency" | "agent" | "show";

export default function SettingsPage() {
  const [role, setRole] = useState<UserRole | null>(null);
  const [email, setEmail] = useState("user@example.com");
  const [plan, setPlan] = useState<PlanId>("pay_as_you_go");
  const [profileLoaded, setProfileLoaded] = useState(false);

  useEffect(() => {
    async function loadProfile() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setEmail(user.email || "user@example.com");
        const { data: profile } = await supabase
          .from("profiles")
          .select("role, plan")
          .eq("id", user.id)
          .single();
        if (profile) {
          setRole(profile.role as UserRole);
          if (profile.plan && (profile.plan as string) in PLANS) {
            setPlan(profile.plan as PlanId);
          }
        }
      }
      setProfileLoaded(true);
    }
    loadProfile();
  }, []);

  const showPayoutSection = role === "show" || role === "agent";
  const showPaymentMethodSection = role === "brand" || role === "agency";

  const planTiers: PlanId[] = ["pay_as_you_go", "operator", "agency"];
  const formatPct = (pct: number) => `${(pct * 100).toFixed(0)}%`;
  const formatMonthly = (cents: number) =>
    cents === 0 ? "$0" : `$${(cents / 100).toLocaleString()}`;
  const planSubline = (id: PlanId) => {
    const p = PLANS[id];
    if (id === "pay_as_you_go") {
      return `${formatPct(p.feePercentage)} transaction fee, no monthly fee`;
    }
    return `${formatMonthly(p.monthlyBaseCents)}/mo + ${formatPct(
      p.feePercentage
    )} transaction`;
  };
  const planFeatureLine = (id: PlanId) => {
    if (id === "pay_as_you_go") return "Up to 2 concurrent campaigns";
    if (id === "operator") return "Unlimited campaigns, API access, priority support";
    return "White-label, multi-client, dedicated success manager";
  };
  const currentPlan = PLANS[plan];

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-2xl font-bold text-[var(--brand-text)] tracking-tight mb-1">Settings</h1>
      <p className="text-sm text-[var(--brand-text-secondary)] mb-8">Manage your account, subscription, and API keys.</p>

      <div className="p-5 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)] mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-semibold text-[var(--brand-text)]">Current Plan</h2>
            <p className="text-sm text-[var(--brand-text-muted)] mt-0.5">
              {currentPlan.label} — {planSubline(plan)}
            </p>
          </div>
          <Link href="/settings/billing" className="px-4 py-2 rounded-lg bg-[var(--brand-blue)] hover:bg-[var(--brand-blue-light)] text-white text-sm font-medium transition-colors">
            Manage subscription
          </Link>
        </div>
        <div className="grid grid-cols-3 gap-4">
          {planTiers.map((id) => {
            const p = PLANS[id];
            const isCurrent = id === plan;
            return (
              <div
                key={id}
                className={`p-4 rounded-lg border transition-colors ${
                  isCurrent
                    ? "border-[var(--brand-blue)] bg-[var(--brand-blue)]/[0.04]"
                    : "border-[var(--brand-border)] hover:border-[var(--brand-blue)]/30"
                }`}
              >
                <div className="flex items-center justify-between mb-0.5">
                  <div className="font-semibold text-[var(--brand-text)]">{p.label}</div>
                  {isCurrent && (
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--brand-blue)]">
                      Current
                    </span>
                  )}
                </div>
                <div className="text-lg font-bold text-[var(--brand-blue)]">
                  {formatMonthly(p.monthlyBaseCents)}
                  <span className="text-xs font-normal text-[var(--brand-text-muted)]">/mo</span>
                </div>
                <div className="text-xs text-[var(--brand-text-muted)] mt-1">
                  + {formatPct(p.feePercentage)} transaction
                </div>
                <div className="text-xs text-[var(--brand-text-muted)] mt-2 leading-snug">
                  {planFeatureLine(id)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="p-5 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)] mb-6">
        <h2 className="font-semibold text-[var(--brand-text)] mb-4">Profile</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-[var(--brand-text)] mb-1.5">Email</label>
            <input type="email" disabled value={email}
              className="w-full px-4 py-2.5 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface)] text-[var(--brand-text-muted)] text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--brand-text)] mb-1.5">Company Name</label>
            <input type="text" placeholder="Your company"
              className="w-full px-4 py-2.5 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-[var(--brand-text)] text-sm placeholder:text-[var(--brand-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/30 focus:border-[var(--brand-blue)] transition-all" />
          </div>
        </div>
      </div>

      {role === "brand" && (
        <Link
          href="/settings/brand-profile"
          className="block p-5 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)] mb-6 hover:border-[var(--brand-blue)]/40 transition-colors"
        >
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-[var(--brand-text)]">Brand profile</h2>
              <p className="text-sm text-[var(--brand-text-muted)] mt-0.5">
                Edit the foundational targeting info we use to score shows for your campaigns.
              </p>
            </div>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--brand-text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </div>
        </Link>
      )}

      {!profileLoaded ? (
        <div className="p-5 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)] mb-6">
          <h2 className="font-semibold text-[var(--brand-text)] mb-4">Payment Settings</h2>
          <p className="text-sm text-[var(--brand-text-muted)]">Loading...</p>
        </div>
      ) : showPayoutSection ? (
        <ConnectOnboarding />
      ) : showPaymentMethodSection ? (
        <CardForm />
      ) : (
        <div className="p-5 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)] mb-6">
          <h2 className="font-semibold text-[var(--brand-text)] mb-4">Payment Settings</h2>
          <p className="text-sm text-[var(--brand-text-muted)]">Set your account role in your profile to enable payment settings.</p>
        </div>
      )}

      <div className="p-5 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)] mb-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold text-[var(--brand-text)]">API & MCP Access</h2>
          <span className="text-xs bg-[var(--brand-blue)]/10 text-[var(--brand-blue)] px-2 py-0.5 rounded-full font-medium">Operator plan required</span>
        </div>
        <p className="text-sm text-[var(--brand-text-muted)] mb-4">Connect Taylslate to your AI workflow via MCP or REST API.</p>
        <button disabled className="px-4 py-2 rounded-lg border border-[var(--brand-border)] text-sm font-medium text-[var(--brand-text-muted)] cursor-not-allowed opacity-50">
          Generate API Key
        </button>
      </div>

      <div className="p-5 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)]">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-[var(--brand-text)]">Session</h2>
            <p className="text-sm text-[var(--brand-text-muted)] mt-0.5">End your session on this device.</p>
          </div>
          <SignOutButton className="px-4 py-2 rounded-lg border border-[var(--brand-border)] text-sm font-medium text-[var(--brand-text)] hover:bg-[var(--brand-surface)] disabled:opacity-50 transition-colors">
            Sign out
          </SignOutButton>
        </div>
      </div>
    </div>
  );
}
