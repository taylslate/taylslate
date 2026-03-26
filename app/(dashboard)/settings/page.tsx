"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import ConnectOnboarding from "@/components/payments/ConnectOnboarding";
import CardForm from "@/components/payments/CardForm";

type UserRole = "brand" | "agency" | "agent" | "show";

export default function SettingsPage() {
  const [role, setRole] = useState<UserRole | null>(null);
  const [email, setEmail] = useState("user@example.com");

  useEffect(() => {
    async function loadProfile() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setEmail(user.email || "user@example.com");
        // Fetch profile to get role
        const { data: profile } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", user.id)
          .single();
        if (profile) {
          setRole(profile.role as UserRole);
        }
      }
    }
    loadProfile();
  }, []);

  const showPayoutSection = role === "show" || role === "agent";
  const showPaymentMethodSection = role === "brand" || role === "agency";

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-2xl font-bold text-[var(--brand-text)] tracking-tight mb-1">Settings</h1>
      <p className="text-sm text-[var(--brand-text-secondary)] mb-8">Manage your account, subscription, and API keys.</p>

      <div className="p-5 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)] mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-semibold text-[var(--brand-text)]">Current Plan</h2>
            <p className="text-sm text-[var(--brand-text-muted)] mt-0.5">Free — 1 campaign per month</p>
          </div>
          <button className="px-4 py-2 rounded-lg bg-[var(--brand-blue)] hover:bg-[var(--brand-blue-light)] text-white text-sm font-medium transition-colors">Upgrade</button>
        </div>
        <div className="grid grid-cols-3 gap-4">
          {[
            { name: "Starter", price: "$49", features: "5 campaigns, outreach emails" },
            { name: "Growth", price: "$149", features: "25 campaigns, ad copy, MCP access" },
            { name: "Business", price: "$349", features: "Unlimited, competitive intel, API" },
          ].map((plan) => (
            <div key={plan.name} className="p-4 rounded-lg border border-[var(--brand-border)] hover:border-[var(--brand-blue)]/30 transition-colors">
              <div className="font-semibold text-[var(--brand-text)] mb-0.5">{plan.name}</div>
              <div className="text-lg font-bold text-[var(--brand-blue)]">{plan.price}<span className="text-xs font-normal text-[var(--brand-text-muted)]">/mo</span></div>
              <div className="text-xs text-[var(--brand-text-muted)] mt-1">{plan.features}</div>
            </div>
          ))}
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

      {showPayoutSection && <ConnectOnboarding />}
      {showPaymentMethodSection && <CardForm />}

      <div className="p-5 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)]">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold text-[var(--brand-text)]">API & MCP Access</h2>
          <span className="text-xs bg-[var(--brand-blue)]/10 text-[var(--brand-blue)] px-2 py-0.5 rounded-full font-medium">Growth plan required</span>
        </div>
        <p className="text-sm text-[var(--brand-text-muted)] mb-4">Connect Taylslate to your AI workflow via MCP or REST API.</p>
        <button disabled className="px-4 py-2 rounded-lg border border-[var(--brand-border)] text-sm font-medium text-[var(--brand-text-muted)] cursor-not-allowed opacity-50">
          Generate API Key
        </button>
      </div>
    </div>
  );
}
