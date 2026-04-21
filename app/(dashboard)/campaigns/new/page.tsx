"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function NewCampaignPage() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(["podcast"]);

  const togglePlatform = (platform: string) => {
    setSelectedPlatforms((prev) =>
      prev.includes(platform) ? prev.filter((p) => p !== platform) : [...prev, platform]
    );
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    const briefText = (formData.get("brief_text") as string)?.trim();

    if (!briefText) {
      setError("Please describe your ideal campaign.");
      setIsSubmitting(false);
      return;
    }

    const body = {
      name: formData.get("name") as string,
      brand_url: (formData.get("brand_url") as string) || undefined,
      budget_total: Number(formData.get("budget_total")),
      platforms: selectedPlatforms,
      brief_text: briefText,
    };

    try {
      const res = await fetch("/api/campaigns/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Something went wrong. Please try again.");
        setIsSubmitting(false);
        return;
      }

      router.push(`/campaigns/${data.campaign_id}`);
    } catch {
      setError("Network error. Please check your connection and try again.");
      setIsSubmitting(false);
    }
  };

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-8">
        <button onClick={() => router.back()} className="flex items-center gap-1.5 text-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors mb-4">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
          Back
        </button>
        <h1 className="text-2xl font-bold text-[var(--brand-text)] tracking-tight">New Campaign</h1>
        <p className="text-sm text-[var(--brand-text-secondary)] mt-1">
          Tell us about your brand and goals. We&apos;ll find the best shows and build your media plan.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-[var(--brand-text)] mb-1.5">Campaign Name</label>
          <input type="text" name="name" required placeholder="e.g., Q2 Fitness Launch"
            className="w-full px-4 py-2.5 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-[var(--brand-text)] text-sm placeholder:text-[var(--brand-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/30 focus:border-[var(--brand-blue)] transition-all" />
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--brand-text)] mb-1.5">Brand Website</label>
          <input type="url" name="brand_url" placeholder="https://yourbrand.com"
            className="w-full px-4 py-2.5 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-[var(--brand-text)] text-sm placeholder:text-[var(--brand-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/30 focus:border-[var(--brand-blue)] transition-all" />
          <p className="text-xs text-[var(--brand-text-muted)] mt-1.5">We&apos;ll analyze your site to understand your brand and audience.</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--brand-text)] mb-2">Platforms</label>
          <div className="flex gap-3">
            {[
              { id: "podcast", label: "Podcasts", icon: "🎙️" },
              { id: "youtube", label: "YouTube", icon: "▶️" },
            ].map((platform) => (
              <button key={platform.id} type="button" onClick={() => togglePlatform(platform.id)}
                className={`flex items-center gap-2.5 px-4 py-3 rounded-xl border text-sm font-medium transition-all flex-1 ${
                  selectedPlatforms.includes(platform.id)
                    ? "border-[var(--brand-blue)] bg-[var(--brand-blue)]/[0.06] text-[var(--brand-blue)]"
                    : "border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-[var(--brand-text-secondary)] hover:border-[var(--brand-text-muted)]"
                }`}>
                <span className="text-lg">{platform.icon}</span>
                {platform.label}
                {selectedPlatforms.includes(platform.id) && (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="ml-auto">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--brand-text)] mb-1.5">Describe your ideal campaign</label>
          <textarea name="brief_text" required rows={7}
            placeholder="e.g. We sell portable saunas and want to reach men 30-45 interested in wellness, recovery, and biohacking. Goal is to drive direct sales through promo codes."
            className="w-full px-4 py-2.5 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-[var(--brand-text)] text-sm placeholder:text-[var(--brand-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/30 focus:border-[var(--brand-blue)] transition-all resize-none" />
          <p className="text-xs text-[var(--brand-text-muted)] mt-1.5">Write in plain English — what you sell, who you want to reach, and your campaign goals. We&apos;ll translate that into search filters automatically.</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--brand-text)] mb-1.5">Campaign Budget (USD)</label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-[var(--brand-text-muted)]">$</span>
            <input type="number" name="budget_total" required min="1000" step="1000" placeholder="20000"
              className="w-full pl-8 pr-4 py-2.5 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-[var(--brand-text)] text-sm placeholder:text-[var(--brand-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/30 focus:border-[var(--brand-blue)] transition-all" />
          </div>
          <p className="text-xs text-[var(--brand-text-muted)] mt-1.5">Minimum $1,000. We recommend at least $5,000 for meaningful testing across 3-5 shows.</p>
        </div>

        <div className="border-t border-[var(--brand-border)] pt-6">
          <button type="submit" disabled={isSubmitting || selectedPlatforms.length === 0}
            className="w-full flex items-center justify-center gap-2 bg-[var(--brand-blue)] hover:bg-[var(--brand-blue-light)] disabled:opacity-50 disabled:cursor-not-allowed text-white py-3 rounded-xl text-sm font-semibold transition-all">
            {isSubmitting ? (
              <>
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Discovering and scoring shows...
              </>
            ) : (
              <>
                Discover Shows
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </>
            )}
          </button>
          {error && (
            <div className="mt-4 p-3 rounded-lg border border-[var(--brand-error)]/30 bg-[var(--brand-error)]/[0.04] text-sm text-[var(--brand-error)]">
              {error}
            </div>
          )}
        </div>
      </form>
    </div>
  );
}
