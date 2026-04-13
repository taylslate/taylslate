"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const interestOptions = [
  "Health & Wellness", "Business & Finance", "Technology", "Entertainment",
  "Sports", "True Crime", "Comedy", "Education", "Parenting & Family",
  "Self-Improvement",
];

export default function NewCampaignPage() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedInterests, setSelectedInterests] = useState<string[]>([]);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(["podcast"]);

  const toggleInterest = (interest: string) => {
    setSelectedInterests((prev) =>
      prev.includes(interest) ? prev.filter((i) => i !== interest) : [...prev, interest]
    );
  };

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
    const keywordsRaw = (formData.get("keywords") as string) || "";

    const body = {
      name: formData.get("name") as string,
      brand_url: (formData.get("brand_url") as string) || undefined,
      budget_total: Number(formData.get("budget_total")),
      platforms: selectedPlatforms,
      target_age_range: (formData.get("age_range") as string) || undefined,
      target_gender: (formData.get("gender") as string) || undefined,
      target_interests: selectedInterests,
      keywords: keywordsRaw ? keywordsRaw.split(",").map((k) => k.trim()).filter(Boolean) : [],
      campaign_goals: (formData.get("campaign_goals") as string) || undefined,
    };

    try {
      // Wave 6: Call scoring engine instead of Claude generation
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

      // Navigate to the discovery list for the new campaign
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

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-[var(--brand-text)] mb-1.5">Age Range</label>
            <select name="age_range" className="w-full px-4 py-2.5 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-[var(--brand-text)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/30 focus:border-[var(--brand-blue)] transition-all">
              <option value="">Any age</option>
              <option value="18-24">18-24</option>
              <option value="25-34">25-34</option>
              <option value="35-44">35-44</option>
              <option value="45-54">45-54</option>
              <option value="55+">55+</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--brand-text)] mb-1.5">Gender</label>
            <select name="gender" className="w-full px-4 py-2.5 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-[var(--brand-text)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/30 focus:border-[var(--brand-blue)] transition-all">
              <option value="">Any gender</option>
              <option value="female">Female</option>
              <option value="male">Male</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--brand-text)] mb-2">Audience Interests</label>
          <div className="flex flex-wrap gap-2">
            {interestOptions.map((interest) => (
              <button key={interest} type="button" onClick={() => toggleInterest(interest)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                  selectedInterests.includes(interest)
                    ? "bg-[var(--brand-blue)] text-white"
                    : "bg-[var(--brand-surface-elevated)] border border-[var(--brand-border)] text-[var(--brand-text-secondary)] hover:border-[var(--brand-blue)]/40 hover:text-[var(--brand-blue)]"
                }`}>
                {interest}
              </button>
            ))}
          </div>
          <p className="text-xs text-[var(--brand-text-muted)] mt-2">Select all that apply to your target customer.</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--brand-text)] mb-1.5">Keywords</label>
          <input type="text" name="keywords" placeholder="e.g., supplements, protein, DTC, health"
            className="w-full px-4 py-2.5 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-[var(--brand-text)] text-sm placeholder:text-[var(--brand-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/30 focus:border-[var(--brand-blue)] transition-all" />
          <p className="text-xs text-[var(--brand-text-muted)] mt-1.5">Comma-separated. These help us find shows that talk about topics relevant to your brand.</p>
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

        <div>
          <label className="block text-sm font-medium text-[var(--brand-text)] mb-1.5">
            Campaign Goals <span className="text-[var(--brand-text-muted)] font-normal ml-1">(optional)</span>
          </label>
          <textarea name="campaign_goals" rows={3} placeholder="e.g., Drive DTC conversions for our new protein powder line targeting active women 25-34"
            className="w-full px-4 py-2.5 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-[var(--brand-text)] text-sm placeholder:text-[var(--brand-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/30 focus:border-[var(--brand-blue)] transition-all resize-none" />
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