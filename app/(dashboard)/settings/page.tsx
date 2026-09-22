"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import ConnectOnboarding from "@/components/payments/ConnectOnboarding";
import CardForm from "@/components/payments/CardForm";
import SignOutButton from "@/components/auth/SignOutButton";
import { PLANS, type PlanId } from "@/lib/billing/plans";
import { tokens } from "@/lib/brand/tokens";

type UserRole = "brand" | "agency" | "agent" | "show";

const radiusStyle = { borderRadius: tokens.radius };

const inkText = "text-[var(--ts-ink-on-paper)]";
const mutedText = "text-[var(--ts-ink-muted-on-paper)]";
const accentText = "text-[var(--ts-accent)]";
const hairlineRule = "border-[var(--ts-hairline-on-paper)]";
const panelClass = "border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)]";
const inkBtnClass =
  "inline-flex items-center bg-[var(--ts-ink-on-paper)] px-4 py-2 text-sm font-medium text-[var(--ts-paper)] hover:opacity-90";
const ghostBtnClass =
  "inline-flex items-center border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-4 py-2 text-sm font-medium text-[var(--ts-ink-on-paper)] hover:bg-[var(--ts-band-shows)] disabled:cursor-not-allowed disabled:opacity-50";
const fieldClass =
  "w-full border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-3 py-2 text-sm text-[var(--ts-ink-on-paper)] placeholder:text-[var(--ts-ink-muted-on-paper)] focus:border-[var(--ts-accent)] focus:outline-none disabled:bg-[var(--ts-band-shows)] disabled:text-[var(--ts-ink-muted-on-paper)]";
const kickerClass =
  "text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--ts-accent)]";

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
  const kicker = role === "show" || role === "agent" ? "For shows" : "For brands";

  return (
    <div className="max-w-2xl p-4 sm:p-8">
      <p className={kickerClass}>{kicker}</p>
      <h1 className={`mt-2 text-2xl font-semibold tracking-tight ${inkText}`}>Settings</h1>
      <p className={`mb-8 mt-1 text-sm ${mutedText}`}>Manage your account, subscription, and API keys.</p>

      <div className={`mb-6 p-5 ${panelClass}`} style={radiusStyle}>
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className={`font-semibold ${inkText}`}>Current Plan</h2>
            <p className={`mt-0.5 text-sm ${mutedText}`}>
              {currentPlan.label} — {planSubline(plan)}
            </p>
          </div>
          <Link href="/settings/billing" className={inkBtnClass} style={radiusStyle}>
            Manage subscription
          </Link>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {planTiers.map((id) => {
            const p = PLANS[id];
            const isCurrent = id === plan;
            return (
              <div
                key={id}
                className={`border p-4 ${hairlineRule} ${
                  isCurrent ? "bg-[var(--ts-band-brands)]" : "bg-[var(--ts-paper)]"
                }`}
                style={radiusStyle}
              >
                <div className="mb-0.5 flex items-center justify-between gap-2">
                  <div className={`font-semibold ${inkText}`}>{p.label}</div>
                  {isCurrent && (
                    <span className={`text-[10px] font-medium uppercase tracking-wider ${accentText}`}>
                      Current
                    </span>
                  )}
                </div>
                <div className={`text-lg font-semibold ${inkText}`}>
                  {formatMonthly(p.monthlyBaseCents)}
                  <span className={`text-xs font-normal ${mutedText}`}>/mo</span>
                </div>
                <div className={`mt-1 text-xs ${mutedText}`}>
                  + {formatPct(p.feePercentage)} transaction
                </div>
                <div className={`mt-2 text-xs leading-snug ${mutedText}`}>
                  {planFeatureLine(id)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className={`mb-6 p-5 ${panelClass}`} style={radiusStyle}>
        <h2 className={`mb-4 font-semibold ${inkText}`}>Profile</h2>
        <div className="space-y-4">
          <div>
            <label className={`mb-1.5 block text-sm font-medium ${inkText}`}>Email</label>
            <input
              type="email"
              disabled
              value={email}
              className={fieldClass}
              style={radiusStyle}
            />
          </div>
          <div>
            <label className={`mb-1.5 block text-sm font-medium ${inkText}`}>Company Name</label>
            <input
              type="text"
              placeholder="Your company"
              className={fieldClass}
              style={radiusStyle}
            />
          </div>
        </div>
      </div>

      {role === "brand" && (
        <Link
          href="/settings/brand-profile"
          className={`mb-6 block p-5 ${panelClass} hover:bg-[var(--ts-band-shows)]`}
          style={radiusStyle}
        >
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className={`font-semibold ${inkText}`}>Brand profile</h2>
              <p className={`mt-0.5 text-sm ${mutedText}`}>
                Edit the foundational targeting info we use to score shows for your campaigns.
              </p>
            </div>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${mutedText}`}>
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </div>
        </Link>
      )}

      {!profileLoaded ? (
        <div className={`mb-6 p-5 ${panelClass}`} style={radiusStyle}>
          <h2 className={`mb-4 font-semibold ${inkText}`}>Payment Settings</h2>
          <p className={`text-sm ${mutedText}`}>Loading...</p>
        </div>
      ) : showPayoutSection ? (
        <ConnectOnboarding />
      ) : showPaymentMethodSection ? (
        <CardForm />
      ) : (
        <div className={`mb-6 p-5 ${panelClass}`} style={radiusStyle}>
          <h2 className={`mb-4 font-semibold ${inkText}`}>Payment Settings</h2>
          <p className={`text-sm ${mutedText}`}>Set your account role in your profile to enable payment settings.</p>
        </div>
      )}

      <div className={`mb-6 p-5 ${panelClass}`} style={radiusStyle}>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className={`font-semibold ${inkText}`}>API & MCP Access</h2>
          <span className={`text-xs font-medium ${mutedText}`}>Operator plan required</span>
        </div>
        <p className={`mb-4 text-sm ${mutedText}`}>Connect Taylslate to your AI workflow via MCP or REST API.</p>
        <button
          disabled
          className={`${ghostBtnClass} cursor-not-allowed text-[var(--ts-ink-muted-on-paper)] opacity-50`}
          style={radiusStyle}
        >
          Generate API Key
        </button>
      </div>

      <div className={`p-5 ${panelClass}`} style={radiusStyle}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className={`font-semibold ${inkText}`}>Session</h2>
            <p className={`mt-0.5 text-sm ${mutedText}`}>End your session on this device.</p>
          </div>
          <SignOutButton className={`${ghostBtnClass} rounded-[var(--ts-radius)]`}>
            Sign out
          </SignOutButton>
        </div>
      </div>
    </div>
  );
}
