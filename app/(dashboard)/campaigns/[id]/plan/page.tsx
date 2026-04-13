"use client";

import { useRouter, useParams } from "next/navigation";

export default function PlanBuilderPage() {
  const router = useRouter();
  const params = useParams();
  const campaignId = params.id as string;

  return (
    <div className="p-8 max-w-3xl">
      <button
        onClick={() => router.push(`/campaigns/${campaignId}`)}
        className="flex items-center gap-1.5 text-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors mb-6"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="m15 18-6-6 6-6" />
        </svg>
        Back to discovery
      </button>

      <h1 className="text-2xl font-bold text-[var(--brand-text)] tracking-tight mb-2">Media Plan Builder</h1>
      <p className="text-sm text-[var(--brand-text-secondary)] mb-8">
        Configure placements, episodes, and spacing for your selected shows.
      </p>

      <div className="rounded-xl border-2 border-dashed border-[var(--brand-border)] p-12 flex flex-col items-center justify-center text-center">
        <div className="w-12 h-12 rounded-xl bg-[var(--brand-blue)]/10 flex items-center justify-center mb-4">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--brand-blue)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" x2="8" y1="13" y2="13" />
            <line x1="16" x2="8" y1="17" y2="17" />
            <line x1="10" x2="8" y1="9" y2="9" />
          </svg>
        </div>
        <p className="text-sm font-medium text-[var(--brand-text)]">Coming in Wave 7</p>
        <p className="text-xs text-[var(--brand-text-muted)] mt-1 max-w-sm">
          Selected shows will become line items with placement configuration, episode scheduling, spacing, and pricing calculations. This feeds directly into IO generation.
        </p>
      </div>
    </div>
  );
}
