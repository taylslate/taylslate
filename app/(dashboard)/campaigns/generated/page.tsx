"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Campaign } from "@/lib/data/types";
import CampaignDetail from "../[id]/campaign-detail";

export default function GeneratedCampaignPage() {
  const router = useRouter();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem("taylslate_generated_campaign");
    if (!stored) {
      router.replace("/campaigns/new");
      return;
    }
    try {
      const parsed = JSON.parse(stored);
      setCampaign(parsed);

      // If the campaign has a real Supabase UUID, redirect to the permanent URL
      // UUIDs are 36 chars with dashes, temp IDs start with "campaign-gen-"
      if (parsed.id && !parsed.id.startsWith("campaign-gen-")) {
        localStorage.removeItem("taylslate_generated_campaign");
        router.replace(`/campaigns/${parsed.id}`);
        return;
      }
    } catch {
      router.replace("/campaigns/new");
    }
    setLoading(false);
  }, [router]);

  if (loading || !campaign) {
    return (
      <div className="p-8 max-w-6xl">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-64 bg-[var(--brand-border)] rounded" />
          <div className="h-4 w-48 bg-[var(--brand-border)] rounded" />
          <div className="grid grid-cols-4 gap-4 mt-6">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-24 bg-[var(--brand-border)] rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return <CampaignDetail campaign={campaign} />;
}
